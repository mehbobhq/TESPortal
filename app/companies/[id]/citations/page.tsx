"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useParams, useRouter } from "next/navigation"
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  DollarSign,
  FileCheck2,
  FileText,
  Gavel,
  History,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Truck,
  Upload,
  User,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
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

type DeadlineStatus =
  | "Healthy"
  | "Watch"
  | "Urgent"
  | "Critical"
  | "Expired"
  | "No Deadline"

type DeadlineRules = {
  healthyMinDays: number
  watchMinDays: number
  urgentMinDays: number
  criticalMinDays: number
  criticalMaxDays: number
}

type Company = {
  id: string
  name: string
  regCorpState?: string
  regCorpCountry?: string
  region?: string
  [key: string]: any
}

type CitationType =
  | "ROADSIDE_INSPECTION"
  | "TRAFFIC_TICKET"
  | "SCALE_VIOLATION"
  | "HOURS_OF_SERVICE"
  | "EQUIPMENT_DEFECT"
  | "WEIGHT_OVERWEIGHT"
  | "HAZMAT_VIOLATION"
  | "NOTICE_OF_CLAIM"
  | "OTHER"

type InspectionLevel =
  | "Level I - Full Inspection"
  | "Level II - Walk-Around"
  | "Level III - Driver-Only"
  | "Level IV - Special Inspection"
  | "Level V - Vehicle-Only"
  | "Level VI - Radioactive Materials"
  | "N/A - Non-Inspection Citation"

type CsaBasicCategory =
  | "Unsafe Driving"
  | "Crash Indicator"
  | "HOS Compliance"
  | "Vehicle Maintenance"
  | "Controlled Substances"
  | "Hazardous Materials"
  | "Driver Fitness"
  | "None"

type AdjudicationStatus =
  | "Pending Review"
  | "Paid in Full"
  | "Contested / In Court"
  | "Reduced"
  | "Dismissed"
  | "Sent to Collections"
  | "No Fine Assessed"

type CitationEvidence = {
  id: string
  recordId?: string
  fileName: string
  mimeType: string
  dataUrl: string
  documentDate: string
  uploadedAt: string
  source: "camera" | "device"
  ocrConfidence?: number
}

type ViolationItem = {
  id: string
  code: string
  description: string
  outOfService: boolean
  basicCategory: CsaBasicCategory
  points?: number
}

type CitationRecord = {
  id: string
  citationType: CitationType
  reportNumber: string
  issuingAgency: string
  jurisdictionCode: string
  jurisdictionLabel: string
  country: string
  
  eventDate: string
  courtDueDate?: string
  resolvedDate?: string
  
  inspectionLevel: InspectionLevel
  officerName?: string
  officerBadge?: string
  location?: string

  driverName?: string
  driverDl?: string
  unitNumber?: string
  vin?: string
  plate?: string

  outOfService: boolean
  violations: ViolationItem[]
  
  fineAmount?: string
  paidAmount?: string
  adjudicationStatus: AdjudicationStatus
  
  notes?: string
  evidenceIds: string[]
  source: "OCR" | "Manual"
  createdAt: string
  updatedAt: string
}

type CitationDraft = {
  citationType: CitationType
  reportNumber: string
  issuingAgency: string
  jurisdictionCode: string
  jurisdictionLabel: string
  country: string
  
  eventDate: string
  courtDueDate: string
  resolvedDate: string
  
  inspectionLevel: InspectionLevel
  officerName: string
  officerBadge: string
  location: string

  driverName: string
  driverDl: string
  unitNumber: string
  vin: string
  plate: string

  outOfService: boolean
  violations: ViolationItem[]
  
  fineAmount: string
  paidAmount: string
  adjudicationStatus: AdjudicationStatus
  notes: string
}

type OCRSession = {
  file: File
  dataUrl: string
  source: "camera" | "device"
  processing: boolean
  extractionComplete: boolean
  confidence?: number
  documentDate: string
  draft: CitationDraft
}

/* =========================================================
   CONSTANTS & JURISDICTIONS
========================================================= */

const SYSTEM_SETTINGS_KEY = "tes_system_settings"

const DEFAULT_DEADLINE_RULES: DeadlineRules = {
  healthyMinDays: 61,
  watchMinDays: 31,
  urgentMinDays: 11,
  criticalMinDays: 0,
  criticalMaxDays: 10,
}

const JURISDICTIONS = [
  { code: "CA-FED", label: "Federal — Canada", country: "Canada" },
  { code: "AB", label: "Alberta", country: "Canada" },
  { code: "BC", label: "British Columbia", country: "Canada" },
  { code: "MB", label: "Manitoba", country: "Canada" },
  { code: "ON", label: "Ontario", country: "Canada" },
  { code: "QC", label: "Quebec", country: "Canada" },
  { code: "SK", label: "Saskatchewan", country: "Canada" },
  { code: "US-FED", label: "Federal — United States", country: "United States" },
  { code: "AZ", label: "Arizona", country: "United States" },
  { code: "CA", label: "California", country: "United States" },
  { code: "IL", label: "Illinois", country: "United States" },
  { code: "MI", label: "Michigan", country: "United States" },
  { code: "NY", label: "New York", country: "United States" },
  { code: "OH", label: "Ohio", country: "United States" },
  { code: "PA", label: "Pennsylvania", country: "United States" },
  { code: "TX", label: "Texas", country: "United States" },
  { code: "WA", label: "Washington", country: "United States" },
]

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function isoNow() {
  return new Date().toISOString()
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function loadDeadlineRules(): DeadlineRules {
  try {
    const raw = localStorage.getItem(SYSTEM_SETTINGS_KEY)
    if (!raw) return DEFAULT_DEADLINE_RULES
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_DEADLINE_RULES, ...(parsed.deadlineRules || parsed.expiryRules || {}) }
  } catch {
    return DEFAULT_DEADLINE_RULES
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function getDaysRemaining(date?: string) {
  if (!date) return null
  const target = new Date(`${date}T23:59:59`)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.ceil((target.getTime() - today.getTime()) / 86400000)
}

function getDeadlineStatus(date: string | undefined, rules: DeadlineRules): DeadlineStatus {
  if (!date) return "No Deadline"
  const days = getDaysRemaining(date)
  if (days === null) return "No Deadline"
  if (days < 0) return "Expired"
  if (days >= rules.criticalMinDays && days <= rules.criticalMaxDays) return "Critical"
  if (days >= rules.urgentMinDays && days < rules.watchMinDays) return "Urgent"
  if (days >= rules.watchMinDays && days < rules.healthyMinDays) return "Watch"
  return "Healthy"
}

function statusClasses(status: DeadlineStatus) {
  switch (status) {
    case "Healthy":
      return { badge: "border-emerald-200 bg-emerald-50 text-emerald-800", left: "border-l-emerald-500" }
    case "Watch":
      return { badge: "border-amber-200 bg-amber-50 text-amber-800", left: "border-l-amber-400" }
    case "Urgent":
      return { badge: "border-red-200 bg-red-50 text-red-700", left: "border-l-red-400" }
    case "Critical":
      return { badge: "border-red-400 bg-red-100 text-red-900", left: "border-l-red-700" }
    case "Expired":
      return { badge: "border-red-900 bg-red-950 text-white", left: "border-l-red-950" }
    default:
      return { badge: "border-slate-200 bg-slate-50 text-slate-600", left: "border-l-slate-300" }
  }
}

function emptyCitationDraft(company: Company): CitationDraft {
  const isCanada = (company.regCorpCountry || "").toLowerCase().includes("canada")
  return {
    citationType: "ROADSIDE_INSPECTION",
    reportNumber: "",
    issuingAgency: isCanada ? "MTO / OPP" : "State Highway Patrol / FMCSA",
    jurisdictionCode: company.regCorpState || (isCanada ? "ON" : "US-FED"),
    jurisdictionLabel: company.regCorpState || (isCanada ? "Ontario" : "Federal — United States"),
    country: isCanada ? "Canada" : "United States",
    eventDate: todayISO(),
    courtDueDate: "",
    resolvedDate: "",
    inspectionLevel: "Level II - Walk-Around",
    officerName: "",
    officerBadge: "",
    location: "",
    driverName: "",
    driverDl: "",
    unitNumber: "",
    vin: "",
    plate: "",
    outOfService: false,
    violations: [],
    fineAmount: "$0.00",
    paidAmount: "$0.00",
    adjudicationStatus: "Pending Review",
    notes: "",
  }
}

/* =========================================================
   SUB-COMPONENTS: VIEWER, FORMS, VIOLATIONS
========================================================= */

function ScanDocumentIcon({ size = 16 }: { size?: number }) {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <span className="absolute inset-0">
        <span className="absolute left-0 top-0 h-[35%] w-[35%] rounded-tl-[2px] border-l-[1.5px] border-t-[1.5px] border-current" />
        <span className="absolute right-0 top-0 h-[35%] w-[35%] rounded-tr-[2px] border-r-[1.5px] border-t-[1.5px] border-current" />
        <span className="absolute bottom-0 left-0 h-[35%] w-[35%] rounded-bl-[2px] border-b-[1.5px] border-l-[1.5px] border-current" />
        <span className="absolute bottom-0 right-0 h-[35%] w-[35%] rounded-br-[2px] border-b-[1.5px] border-r-[1.5px] border-current" />
      </span>
      <FileText style={{ width: size * 0.58, height: size * 0.58, strokeWidth: 1.8 }} />
    </span>
  )
}

function CopyField({ label, value }: { label: string; value?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 900)
    } catch {}
  }

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span className="min-w-0 flex-1 select-text break-words text-xs font-medium">{value || "—"}</span>
        {value && (
          <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" onClick={copy}>
            {copied ? <CheckCircle2 className="size-3 text-emerald-600" /> : <Copy className="size-3 text-muted-foreground" />}
          </Button>
        )}
      </div>
    </div>
  )
}

function ViolationEditor({
  violations,
  onChange,
}: {
  violations: ViolationItem[]
  onChange: (items: ViolationItem[]) => void
}) {
  const addViolation = () => {
    onChange([
      ...violations,
      {
        id: createId("VIO"),
        code: "",
        description: "",
        outOfService: false,
        basicCategory: "Vehicle Maintenance",
        points: 3,
      },
    ])
  }

  const updateItem = (id: string, patch: Partial<ViolationItem>) => {
    onChange(violations.map((v) => (v.id === id ? { ...v, ...patch } : v)))
  }

  const removeItem = (id: string) => {
    onChange(violations.filter((v) => v.id !== id))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Violations & Deficiencies</Label>
          <p className="text-[11px] text-muted-foreground">Record specific code citations, OOS status, and CSA categories.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addViolation} className="h-7 text-xs">
          <Plus className="mr-1 size-3.5" /> Add Violation
        </Button>
      </div>

      {violations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          No violations cited (Clean Inspection).
        </div>
      ) : (
        <div className="space-y-3">
          {violations.map((item, idx) => (
            <div key={item.id} className="rounded-lg border bg-background p-3 space-y-3">
              <div className="flex items-center justify-between gap-2 border-b pb-2">
                <span className="text-xs font-semibold">Violation #{idx + 1}</span>
                <Button type="button" variant="ghost" size="icon" className="size-6 text-destructive" onClick={() => removeItem(item.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-[10px]">Violation Code</Label>
                  <Input placeholder="e.g. 393.45 / 396.3A1" value={item.code} onChange={(e) => updateItem(item.id, { code: e.target.value })} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-[10px]">Description</Label>
                  <Input placeholder="Brake hose air leak..." value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 items-center">
                <div className="space-y-1">
                  <Label className="text-[10px]">BASIC Category</Label>
                  <Select value={item.basicCategory} onValueChange={(val) => updateItem(item.id, { basicCategory: val as CsaBasicCategory })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Vehicle Maintenance">Vehicle Maintenance</SelectItem>
                      <SelectItem value="HOS Compliance">HOS Compliance</SelectItem>
                      <SelectItem value="Unsafe Driving">Unsafe Driving</SelectItem>
                      <SelectItem value="Driver Fitness">Driver Fitness</SelectItem>
                      <SelectItem value="Controlled Substances">Controlled Substances</SelectItem>
                      <SelectItem value="Hazardous Materials">Hazardous Materials</SelectItem>
                      <SelectItem value="Crash Indicator">Crash Indicator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Severity Points</Label>
                  <Input type="number" className="h-8 text-xs" value={item.points || 0} onChange={(e) => updateItem(item.id, { points: Number(e.target.value) })} />
                </div>
                <div className="flex items-center gap-2 pt-4">
                  <input
                    type="checkbox"
                    id={`oos-${item.id}`}
                    checked={item.outOfService}
                    onChange={(e) => updateItem(item.id, { outOfService: e.target.checked })}
                    className="size-4 rounded border-border"
                  />
                  <Label htmlFor={`oos-${item.id}`} className="text-xs font-semibold text-destructive cursor-pointer">
                    Out of Service (OOS)
                  </Label>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CitationForm({
  draft,
  onChange,
}: {
  draft: CitationDraft
  onChange: (draft: CitationDraft) => void
}) {
  const patch = (val: Partial<CitationDraft>) => onChange({ ...draft, ...val })

  return (
    <div className="space-y-6">
      {/* 1. Citation & Agency */}
      <Card>
        <CardHeader className="bg-muted/20 py-3 border-b">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gavel className="size-4 text-primary" /> Citation / Inspection Header
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Record Type *</Label>
            <Select value={draft.citationType} onValueChange={(val) => patch({ citationType: val as CitationType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ROADSIDE_INSPECTION">Roadside Inspection Report</SelectItem>
                <SelectItem value="TRAFFIC_TICKET">Traffic Ticket / Moving Violation</SelectItem>
                <SelectItem value="SCALE_VIOLATION">Weigh Scale / Bypass Violation</SelectItem>
                <SelectItem value="HOURS_OF_SERVICE">HOS / Logbook Citation</SelectItem>
                <SelectItem value="WEIGHT_OVERWEIGHT">Overweight / Dimension Fine</SelectItem>
                <SelectItem value="NOTICE_OF_CLAIM">FMCSA Notice of Claim</SelectItem>
                <SelectItem value="OTHER">Other State / Provincial Citation</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Report / Ticket Number *</Label>
            <Input placeholder="e.g. US-CA-2026-91823" value={draft.reportNumber} onChange={(e) => patch({ reportNumber: e.target.value })} required />
          </div>

          <div className="space-y-1.5">
            <Label>Issuing Agency / Regulator *</Label>
            <Input placeholder="e.g. CHP / MTO / OPP" value={draft.issuingAgency} onChange={(e) => patch({ issuingAgency: e.target.value })} required />
          </div>

          <div className="space-y-1.5">
            <Label>Inspection Level</Label>
            <Select value={draft.inspectionLevel} onValueChange={(val) => patch({ inspectionLevel: val as InspectionLevel })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Level I - Full Inspection">Level I - Full Inspection</SelectItem>
                <SelectItem value="Level II - Walk-Around">Level II - Walk-Around</SelectItem>
                <SelectItem value="Level III - Driver-Only">Level III - Driver-Only</SelectItem>
                <SelectItem value="Level IV - Special Inspection">Level IV - Special Inspection</SelectItem>
                <SelectItem value="Level V - Vehicle-Only">Level V - Vehicle-Only</SelectItem>
                <SelectItem value="N/A - Non-Inspection Citation">N/A - Non-Inspection Citation</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Event Date *</Label>
            <Input type="date" value={draft.eventDate} onChange={(e) => patch({ eventDate: e.target.value })} required />
          </div>

          <div className="space-y-1.5">
            <Label>Location / Highway</Label>
            <Input placeholder="I-80 EB Milepost 140" value={draft.location} onChange={(e) => patch({ location: e.target.value })} />
          </div>

          <div className="space-y-1.5">
            <Label>Jurisdiction *</Label>
            <Select value={draft.jurisdictionCode} onValueChange={(code) => {
              const j = JURISDICTIONS.find((item) => item.code === code)
              if (j) patch({ jurisdictionCode: j.code, jurisdictionLabel: j.label, country: j.country })
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {JURISDICTIONS.map((j) => <SelectItem key={j.code} value={j.code}>{j.label} ({j.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Officer Name & Badge</Label>
            <Input placeholder="Officer Smith #482" value={draft.officerName} onChange={(e) => patch({ officerName: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      {/* 2. Driver & Vehicle Linkage */}
      <Card>
        <CardHeader className="bg-muted/20 py-3 border-b">
          <CardTitle className="text-sm flex items-center gap-2">
            <Truck className="size-4 text-primary" /> Vehicle & Driver Entity Link
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label>Driver Full Name</Label>
            <Input placeholder="John Doe" value={draft.driverName} onChange={(e) => patch({ driverName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Driver CDL #</Label>
            <Input placeholder="CDL-918239" value={draft.driverDl} onChange={(e) => patch({ driverDl: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Unit / Tractor #</Label>
            <Input placeholder="Unit 102" value={draft.unitNumber} onChange={(e) => patch({ unitNumber: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>VIN / License Plate</Label>
            <Input placeholder="VIN or Plate" value={draft.plate} onChange={(e) => patch({ plate: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      {/* 3. Violations Breakdown */}
      <Card>
        <CardHeader className="bg-muted/20 py-3 border-b">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="size-4 text-primary" /> Violations & Safety Deficiencies
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <ViolationEditor violations={draft.violations} onChange={(v) => patch({ violations: v, outOfService: v.some((i) => i.outOfService) })} />
        </CardContent>
      </Card>

      {/* 4. Financial & Court Settlement */}
      <Card>
        <CardHeader className="bg-muted/20 py-3 border-b">
          <CardTitle className="text-sm flex items-center gap-2">
            <Scale className="size-4 text-primary" /> Financials & Adjudication
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label>Adjudication Status</Label>
            <Select value={draft.adjudicationStatus} onValueChange={(val) => patch({ adjudicationStatus: val as AdjudicationStatus })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Pending Review">Pending Review</SelectItem>
                <SelectItem value="Contested / In Court">Contested / In Court</SelectItem>
                <SelectItem value="Paid in Full">Paid in Full</SelectItem>
                <SelectItem value="Reduced">Reduced</SelectItem>
                <SelectItem value="Dismissed">Dismissed</SelectItem>
                <SelectItem value="No Fine Assessed">No Fine Assessed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Fine Amount</Label>
            <Input placeholder="$0.00" value={draft.fineAmount} onChange={(e) => patch({ fineAmount: e.target.value })} />
          </div>

          <div className="space-y-1.5">
            <Label>Court / Appearance Date</Label>
            <Input type="date" value={draft.courtDueDate} onChange={(e) => patch({ courtDueDate: e.target.value })} />
          </div>

          <div className="space-y-1.5">
            <Label>Resolution Date</Label>
            <Input type="date" value={draft.resolvedDate} onChange={(e) => patch({ resolvedDate: e.target.value })} />
          </div>

          <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
            <Label>Notes & Contest Plan</Label>
            <Textarea placeholder="Details regarding citations, attorney contact, or DataQs challenge status..." value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* =========================================================
   MAIN COMPONENT PAGE
========================================================= */

export default function CitationsPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [company, setCompany] = useState<Company | null>(null)
  const [citations, setCitations] = useState<CitationRecord[]>([])
  const [evidenceList, setEvidenceList] = useState<CitationEvidence[]>([])
  const [rules, setRules] = useState<DeadlineRules>(DEFAULT_DEADLINE_RULES)
  const [loading, setLoading] = useState(true)

  // Filters & Inspector State
  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterType, setFilterType] = useState<string>("ALL")
  const [showOlderHistory, setShowOlderHistory] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<CitationEvidence | null>(null)

  // Modals
  const [manualDraft, setManualDraft] = useState<CitationDraft | null>(null)
  const [ocrSession, setOcrSession] = useState<OCRSession | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  const storageKey = `tes_company_citations_${companyId}`

  useEffect(() => {
    try {
      const companies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
      const current = companies.find((c: any) => c.id === companyId) || null
      setCompany(current)

      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        setCitations(Array.isArray(parsed.citations) ? parsed.citations : [])
        setEvidenceList(Array.isArray(parsed.evidence) ? parsed.evidence : [])
      }
      setRules(loadDeadlineRules())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [companyId, storageKey])

  useEffect(() => {
    if (!loading) {
      localStorage.setItem(storageKey, JSON.stringify({ citations, evidence: evidenceList }))
    }
  }, [citations, evidenceList, loading, storageKey])

  // Filter 3-year history
  const threeYearsAgo = useMemo(() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 3)
    return d.toISOString().slice(0, 10)
  }, [])

  const filteredCitations = useMemo(() => {
    return citations.filter((c) => {
      const matchesSearch =
        !searchQuery ||
        c.reportNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.driverName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.unitNumber || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.issuingAgency.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesType = filterType === "ALL" || c.citationType === filterType
      const matchesHistory = showOlderHistory || c.eventDate >= threeYearsAgo

      return matchesSearch && matchesType && matchesHistory
    })
  }, [citations, searchQuery, filterType, showOlderHistory, threeYearsAgo])

  const selectedRecord = useMemo(
    () => citations.find((c) => c.id === selectedCitationId) || null,
    [citations, selectedCitationId]
  )

  const totalOOS = useMemo(() => citations.filter((c) => c.outOfService).length, [citations])
  const pendingCount = useMemo(() => citations.filter((c) => c.adjudicationStatus === "Pending Review" || c.adjudicationStatus === "Contested / In Court").length, [citations])

  const handleSaveDraft = (draft: CitationDraft, source: "OCR" | "Manual", evidence?: CitationEvidence) => {
    const now = isoNow()
    if (isEditing && selectedCitationId) {
      setCitations((prev) =>
        prev.map((c) => (c.id === selectedCitationId ? { ...c, ...draft, updatedAt: now } : c))
      )
      setIsEditing(false)
    } else {
      const newRec: CitationRecord = {
        id: createId("CIT"),
        ...draft,
        evidenceIds: evidence ? [evidence.id] : [],
        source,
        createdAt: now,
        updatedAt: now,
      }
      setCitations((prev) => [newRec, ...prev])
      if (evidence) setEvidenceList((prev) => [evidence, ...prev])
      setSelectedCitationId(newRec.id)
    }
    setManualDraft(null)
    setOcrSession(null)
  }

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this citation record?")) return
    setCitations((prev) => prev.filter((c) => c.id !== id))
    if (selectedCitationId === id) setSelectedCitationId(null)
  }

  const handleFileUpload = async (file: File) => {
    const dataUrl = await readFileAsDataUrl(file)
    const draft = emptyCitationDraft(company || { id: companyId, name: "" })

    // Simulate OCR Intelligence Extraction
    draft.reportNumber = `INSP-${Math.floor(100000 + Math.random() * 900000)}`
    draft.officerName = "Officer J. Miller"
    draft.officerBadge = "Badge #4928"

    setOcrSession({
      file,
      dataUrl,
      source: "device",
      processing: false,
      extractionComplete: true,
      confidence: 94,
      documentDate: todayISO(),
      draft,
    })
  }

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex max-w-[1600px] flex-col gap-6 pb-12">
      {/* 1. Header & Quick Context */}
      <div>
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/companies/${companyId}/profile`)}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Citations & Roadside Inspections</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {company?.name} <span className="font-mono text-xs">({companyId})</span> · FMCSA Roadside Inspections, CVOR Points & Traffic Citations
            </p>
          </div>
        </div>

        {/* 2. Top Stats KPIs */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-l-4 border-l-primary">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Violations (YTD)</p>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl font-bold">{citations.length}</span>
                <Badge variant="outline" className="text-xs">{filteredCitations.length} active</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-destructive">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Out of Service (OOS)</p>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl font-bold text-destructive">{totalOOS}</span>
                <span className="text-[10px] text-muted-foreground">Critical Safety</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Pending Adjudication</p>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl font-bold text-amber-600">{pendingCount}</span>
                <span className="text-[10px] text-muted-foreground">In Review / Court</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-emerald-500">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Clean Inspections</p>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl font-bold text-emerald-600">{citations.filter((c) => c.violations.length === 0).length}</span>
                <span className="text-[10px] text-muted-foreground">Passed</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 3. Action Controls */}
      <div className="flex flex-col sm:flex-row justify-between gap-3 items-stretch sm:items-center">
        <div className="flex flex-1 items-center gap-2 max-w-lg">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input placeholder="Search report #, officer, driver, or unit..." className="pl-9 h-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Types</SelectItem>
              <SelectItem value="ROADSIDE_INSPECTION">Roadside Inspection</SelectItem>
              <SelectItem value="TRAFFIC_TICKET">Traffic Ticket</SelectItem>
              <SelectItem value="SCALE_VIOLATION">Scale / Weight</SelectItem>
              <SelectItem value="HOURS_OF_SERVICE">HOS Citation</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowOlderHistory((prev) => !prev)}>
            <History className="mr-1.5 size-3.5" />
            {showOlderHistory ? "Standard 3-Year" : "Show Retained History"}
          </Button>

          <Button onClick={() => fileInputRef.current?.click()} size="sm" className="bg-primary text-primary-foreground">
            <ScanDocumentIcon size={14} />
            <span className="ml-1.5">Scan Notice (OCR)</span>
          </Button>

          <Button onClick={() => setManualDraft(emptyCitationDraft(company || { id: companyId, name: "" }))} size="sm" variant="outline">
            <Plus className="mr-1 size-3.5" /> Add Citation
          </Button>
        </div>
      </div>

      {/* 4. Main Master-Detail Ledger Grid */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* Table Ledger */}
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/20 py-3 border-b">
            <CardTitle className="text-sm">Inspection & Citation Register</CardTitle>
            <CardDescription className="text-xs">Live record of regulatory interventions, safety points, and outcomes.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {filteredCitations.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
                <ShieldCheck className="size-10 text-muted-foreground/30" />
                <p>No citations or roadside violations found.</p>
              </div>
            ) : (
              <div className="divide-y text-sm">
                {filteredCitations.map((item) => {
                  const isSelected = selectedCitationId === item.id
                  const deadlineStatus = getDeadlineStatus(item.courtDueDate, rules)
                  const style = statusClasses(deadlineStatus)

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedCitationId(item.id)}
                      className={`grid cursor-pointer gap-4 border-l-4 p-4 transition-colors md:grid-cols-12 ${style.left} ${
                        isSelected ? "bg-primary/[0.045]" : "hover:bg-muted/25"
                      }`}
                    >
                      <div className="md:col-span-3">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <span>{item.reportNumber}</span>
                          {item.outOfService && <Badge variant="destructive" className="text-[9px] px-1 py-0">OOS</Badge>}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{item.issuingAgency} · {item.jurisdictionLabel}</p>
                      </div>

                      <div className="md:col-span-3 text-xs">
                        <p className="font-medium">{item.driverName || "Driver not stated"}</p>
                        <p className="text-[10px] text-muted-foreground">{item.unitNumber ? `Unit ${item.unitNumber}` : item.plate || "No unit specified"}</p>
                      </div>

                      <div className="md:col-span-2 text-xs">
                        <p>{item.eventDate}</p>
                        <p className="text-[10px] text-muted-foreground">{item.inspectionLevel}</p>
                      </div>

                      <div className="md:col-span-2 text-xs">
                        <p className="font-semibold">{item.violations.length} Violations</p>
                        <p className="text-[10px] text-muted-foreground">{item.adjudicationStatus}</p>
                      </div>

                      <div className="flex items-center justify-end gap-2 md:col-span-2">
                        {item.courtDueDate && <Badge variant="outline" className={style.badge}>{deadlineStatus}</Badge>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detail Inspector Panel */}
        <div className="xl:sticky xl:top-6">
          {!selectedRecord ? (
            <Card className="border-dashed">
              <CardContent className="flex min-h-[480px] flex-col items-center justify-center p-8 text-center text-muted-foreground">
                <Gavel className="size-10 opacity-30 mb-3" />
                <p className="text-sm font-medium">Select a citation record</p>
                <p className="text-xs max-w-xs mt-1">Review inspection violations, officer statements, court due dates, and evidence.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="bg-muted/20 border-b py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileCheck2 className="size-4 text-primary" /> {selectedRecord.reportNumber}
                    </CardTitle>
                    <CardDescription className="text-xs">{selectedRecord.issuingAgency} · {selectedRecord.eventDate}</CardDescription>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setSelectedCitationId(null)} className="size-7">
                    <X className="size-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <CopyField label="Citation Type" value={selectedRecord.citationType.replaceAll("_", " ")} />
                  <CopyField label="Inspection Level" value={selectedRecord.inspectionLevel} />
                  <CopyField label="Driver Name" value={selectedRecord.driverName} />
                  <CopyField label="Driver CDL #" value={selectedRecord.driverDl} />
                  <CopyField label="Tractor / Unit #" value={selectedRecord.unitNumber} />
                  <CopyField label="Plate / VIN" value={selectedRecord.plate || selectedRecord.vin} />
                  <CopyField label="Fine Amount" value={selectedRecord.fineAmount} />
                  <CopyField label="Court Due Date" value={selectedRecord.courtDueDate} />
                </div>

                {selectedRecord.violations.length > 0 && (
                  <div className="border-t pt-3">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">Violations Breakdown</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {selectedRecord.violations.map((v) => (
                        <div key={v.id} className="rounded border p-2 text-xs bg-muted/10">
                          <div className="flex justify-between items-center font-semibold">
                            <span>{v.code}</span>
                            {v.outOfService && <span className="text-[10px] text-destructive">OOS</span>}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{v.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedRecord.notes && (
                  <div className="border-t pt-3">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Internal Notes</p>
                    <p className="text-xs text-muted-foreground leading-relaxed bg-muted/20 p-2 rounded">{selectedRecord.notes}</p>
                  </div>
                )}

                <div className="flex gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    className="flex-1"
                    size="sm"
                    onClick={() => {
                      setIsEditing(true)
                      setManualDraft({
                        citationType: selectedRecord.citationType,
                        reportNumber: selectedRecord.reportNumber,
                        issuingAgency: selectedRecord.issuingAgency,
                        jurisdictionCode: selectedRecord.jurisdictionCode,
                        jurisdictionLabel: selectedRecord.jurisdictionLabel,
                        country: selectedRecord.country,
                        eventDate: selectedRecord.eventDate,
                        courtDueDate: selectedRecord.courtDueDate || "",
                        resolvedDate: selectedRecord.resolvedDate || "",
                        inspectionLevel: selectedRecord.inspectionLevel,
                        officerName: selectedRecord.officerName || "",
                        officerBadge: selectedRecord.officerBadge || "",
                        location: selectedRecord.location || "",
                        driverName: selectedRecord.driverName || "",
                        driverDl: selectedRecord.driverDl || "",
                        unitNumber: selectedRecord.unitNumber || "",
                        vin: selectedRecord.vin || "",
                        plate: selectedRecord.plate || "",
                        outOfService: selectedRecord.outOfService,
                        violations: selectedRecord.violations,
                        fineAmount: selectedRecord.fineAmount || "$0.00",
                        paidAmount: selectedRecord.paidAmount || "$0.00",
                        adjudicationStatus: selectedRecord.adjudicationStatus,
                        notes: selectedRecord.notes || "",
                      })
                    }}
                  >
                    <Pencil className="mr-1.5 size-3.5" /> Edit Record
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(selectedRecord.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (f) handleFileUpload(f)
        }}
      />

      {/* Manual Add / Edit Modal */}
      {manualDraft && (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-black/45 p-4 backdrop-blur-sm">
          <div className="mx-auto my-6 max-w-5xl">
            <Card>
              <CardHeader className="border-b">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{isEditing ? "Edit Citation" : "Add Citation / Inspection"}</CardTitle>
                    <CardDescription className="text-xs">Record safety compliance data for reporting and CVOR/SMS analytics.</CardDescription>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setManualDraft(null)}><X className="size-4" /></Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <CitationForm draft={manualDraft} onChange={setManualDraft} />
                <div className="flex justify-end gap-2 border-t pt-5 mt-6">
                  <Button variant="outline" onClick={() => setManualDraft(null)}>Cancel</Button>
                  <Button onClick={() => handleSaveDraft(manualDraft, "Manual")}><Save className="mr-1.5 size-4" /> Save Record</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* OCR Workspace Review */}
      {ocrSession && (
        <div className="fixed inset-0 z-[130] flex flex-col bg-background">
          <div className="flex min-h-16 items-center justify-between border-b px-5">
            <div className="flex items-center gap-3">
              <ScanDocumentIcon size={18} />
              <div>
                <p className="text-sm font-semibold flex items-center gap-2">
                  Document Intelligence OCR Review <Badge variant="outline" className="text-[10px]">AI Assisted</Badge>
                </p>
                <p className="text-[10px] text-muted-foreground">{ocrSession.file.name}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setOcrSession(null)}><X className="size-5" /></Button>
          </div>
          <div className="grid min-h-0 flex-1 xl:grid-cols-2">
            <div className="border-r p-4 bg-muted/10 overflow-hidden">
              <embed src={ocrSession.dataUrl} className="w-full h-full rounded border bg-background" />
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              <CitationForm draft={ocrSession.draft} onChange={(d) => setOcrSession({ ...ocrSession, draft: d })} />
              <div className="flex justify-end gap-2 border-t pt-4">
                <Button variant="outline" onClick={() => setOcrSession(null)}>Discard</Button>
                <Button onClick={() => {
                  const ev: CitationEvidence = {
                    id: createId("DOC"),
                    fileName: ocrSession.file.name,
                    mimeType: ocrSession.file.type,
                    dataUrl: ocrSession.dataUrl,
                    documentDate: ocrSession.documentDate,
                    uploadedAt: isoNow(),
                    source: ocrSession.source,
                    ocrConfidence: ocrSession.confidence,
                  }
                  handleSaveDraft(ocrSession.draft, "OCR", ev)
                }}>
                  <Check className="mr-1.5 size-4" /> Accept & Save Citation
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}