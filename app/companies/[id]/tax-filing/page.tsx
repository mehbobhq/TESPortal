"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  Landmark,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  Receipt,
  RefreshCcw,
  Settings2,
  Upload,
  X,
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

/* =========================================================
   TYPES
========================================================= */

type Company = {
  id: string
  name: string
  regCorpState?: string
  regCorpCountry?: string
  region?: string
  [key: string]: any
}

type RuleValue = "applies" | "does-not-apply" | "not-configured"

type TaxCode =
  | "ifta"
  | "ct_huf"
  | "ny_hut"
  | "kyu"
  | "nm_wdt"
  | "or_wmt"
  | "form_2290"
  | "fuel_charge_registration"
  | "texas_excise_tax"
  | "arkansas_motor_fuel_tax"
  | "ontario_tobacco_tax"

type FilingFrequency =
  | "monthly"
  | "quarterly"
  | "annual"
  | "event-based"
  | "historical-only"
  | "not-set"

type TaxProfileStatus = "Active" | "Pending" | "Suspended" | "Inactive" | "Closed"

type FilingStatus =
  | "Not Started"
  | "Awaiting Data"
  | "Ready to File"
  | "Filed"
  | "Payment Pending"
  | "Completed"
  | "Overdue"
  | "No Return Required"

type ReturnType =
  | "Activity Return"
  | "Zero Return"
  | "Final Return"
  | "Amended / Corrective Return"
  | "No Return Required"
  | "Not Determined"

type FilingMethod = "Online" | "Paper" | "Amended / Corrective Filing"

type PaymentStatus =
  | "Not Applicable"
  | "Unpaid"
  | "Partially Paid"
  | "Paid"
  | "Refund"
  | "Pending"

type VerificationSource =
  | "Government Portal"
  | "Official Notice"
  | "Permit / Registration"
  | "Filed Return"
  | "Client Instruction"
  | "Other"
  | ""

type AssignmentType =
  | "Regulatory Default"
  | "Authority Assigned"
  | "Company Elected"
  | "Manual Override"

type FrequencyAssignment = {
  id: string
  frequency: FilingFrequency
  effectiveFrom: string
  effectiveTo?: string
  assignmentType: AssignmentType
  source: VerificationSource
  sourceReference?: string
  verifiedDate?: string
  verifiedBy?: string
  notes?: string
  createdAt: string
}

type TaxProfile = {
  id: string
  taxCode: TaxCode
  accountNumber?: string
  accountStatus: TaxProfileStatus
  filingFrequency: FilingFrequency
  frequencyHistory: FrequencyAssignment[]
  effectiveDate?: string
  closureDate?: string
  verificationSource: VerificationSource
  verificationReference?: string
  lastVerifiedDate?: string
  lastVerifiedBy?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

type FilingObligation = {
  id: string
  taxProfileId: string
  taxCode: TaxCode
  frequencySnapshot: FilingFrequency
  reportingPeriodLabel: string
  reportingPeriodStart: string
  reportingPeriodEnd: string
  nominalDueDate: string
  dueDate: string
  status: FilingStatus
  profileUpdatedAtSnapshot: string
  frequencyAssignmentId?: string
  createdAt: string
  updatedAt: string
}

type FilingSubmission = {
  id: string
  obligationId: string
  returnType: ReturnType
  filingMethod: FilingMethod
  filingDate?: string
  amountDue?: string
  amountPaid?: string
  paymentStatus: PaymentStatus
  confirmationNumber?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

type TaxDocument = {
  id: string
  fileName: string
  mimeType: string
  dataUrl: string
  documentType:
    | "Registration"
    | "Tax Return"
    | "Filing Receipt"
    | "Payment Receipt"
    | "Official Notice"
    | "Supporting Document"
  taxCode?: TaxCode
  profileId?: string
  obligationId?: string
  submissionId?: string
  documentDate?: string
  uploadedAt: string
  ocrConfidence?: number
}

type TaxData = {
  version: number
  profiles: TaxProfile[]
  obligations: FilingObligation[]
  submissions: FilingSubmission[]
  documents: TaxDocument[]
}

type TaxDefinition = {
  code: TaxCode
  name: string
  shortName: string
  jurisdiction: string
  description: string
  frequencyOptions: FilingFrequency[]
  defaultFrequency: FilingFrequency
  accountLabel: string
  accountRequired: boolean
  historicalOnly?: boolean
}

type CompanySettings = {
  rules?: Record<string, RuleValue>
}

/* =========================================================
   STORAGE / DEFINITIONS
========================================================= */

const SETTINGS_STORAGE_PREFIX = "tes_company_compliance_settings_"
const TAX_STORAGE_PREFIX = "tes_company_tax_filing_"
const DATA_VERSION = 1

const EMPTY_DATA: TaxData = {
  version: DATA_VERSION,
  profiles: [],
  obligations: [],
  submissions: [],
  documents: [],
}

const TAX_DEFINITIONS: TaxDefinition[] = [
  {
    code: "ifta",
    name: "International Fuel Tax Agreement",
    shortName: "IFTA",
    jurisdiction: "Multi-jurisdictional",
    description: "Quarterly fuel-tax reporting for applicable interstate / cross-border operations.",
    frequencyOptions: ["quarterly"],
    defaultFrequency: "quarterly",
    accountLabel: "IFTA Account / Licence Number",
    accountRequired: true,
  },
  {
    code: "ct_huf",
    name: "Connecticut Highway Use Fee",
    shortName: "CT HUF",
    jurisdiction: "Connecticut",
    description: "Connecticut highway-use filing obligation for applicable carriers.",
    frequencyOptions: ["quarterly"],
    defaultFrequency: "quarterly",
    accountLabel: "Connecticut Account Number",
    accountRequired: true,
  },
  {
    code: "ny_hut",
    name: "New York Highway Use Tax",
    shortName: "NY HUT",
    jurisdiction: "New York",
    description: "Current filing frequency is company-specific and can move between quarterly and annual.",
    frequencyOptions: ["quarterly", "annual"],
    defaultFrequency: "quarterly",
    accountLabel: "NY HUT Account / Certificate Number",
    accountRequired: true,
  },
  {
    code: "kyu",
    name: "Kentucky Weight Distance Tax / KYU",
    shortName: "KYU",
    jurisdiction: "Kentucky",
    description: "Kentucky weight-distance filing obligation for applicable carriers.",
    frequencyOptions: ["quarterly"],
    defaultFrequency: "quarterly",
    accountLabel: "KYU Account Number",
    accountRequired: true,
  },
  {
    code: "nm_wdt",
    name: "New Mexico Weight Distance Tax",
    shortName: "NM WDT",
    jurisdiction: "New Mexico",
    description: "New Mexico weight-distance filing obligation for applicable carriers.",
    frequencyOptions: ["quarterly"],
    defaultFrequency: "quarterly",
    accountLabel: "New Mexico Account Number",
    accountRequired: true,
  },
  {
    code: "or_wmt",
    name: "Oregon Weight-Mile Tax",
    shortName: "OR WMT",
    jurisdiction: "Oregon",
    description: "Current company frequency may be monthly or quarterly.",
    frequencyOptions: ["monthly", "quarterly"],
    defaultFrequency: "monthly",
    accountLabel: "Oregon Account Number",
    accountRequired: true,
  },
  {
    code: "form_2290",
    name: "Federal Heavy Highway Vehicle Use Tax — Form 2290",
    shortName: "Form 2290",
    jurisdiction: "United States — Federal",
    description: "Annual tax-period filing with event-based first-use obligations.",
    frequencyOptions: ["annual", "event-based"],
    defaultFrequency: "annual",
    accountLabel: "EIN / Filing Account Reference",
    accountRequired: false,
  },
  {
    code: "fuel_charge_registration",
    name: "Fuel Charge Registration",
    shortName: "Fuel Charge",
    jurisdiction: "Canada — Federal",
    description: "Retained for outstanding historical obligations and legacy records.",
    frequencyOptions: ["historical-only"],
    defaultFrequency: "historical-only",
    accountLabel: "Fuel Charge Registration Number",
    accountRequired: false,
    historicalOnly: true,
  },
  {
    code: "texas_excise_tax",
    name: "Texas Excise Tax",
    shortName: "Texas Excise",
    jurisdiction: "Texas",
    description: "Separate Texas excise / fuel-tax filing where applicable.",
    frequencyOptions: ["monthly", "quarterly"],
    defaultFrequency: "monthly",
    accountLabel: "Texas Tax Account Number",
    accountRequired: false,
  },
  {
    code: "arkansas_motor_fuel_tax",
    name: "Arkansas Motor Fuel Tax",
    shortName: "Arkansas MFT",
    jurisdiction: "Arkansas",
    description: "Most ordinary activity may be handled through IFTA; separate account schedules can vary.",
    frequencyOptions: ["quarterly", "monthly"],
    defaultFrequency: "quarterly",
    accountLabel: "Arkansas Tax Account Number",
    accountRequired: false,
  },
  {
    code: "ontario_tobacco_tax",
    name: "Ontario Tobacco Tax",
    shortName: "Ontario Tobacco",
    jurisdiction: "Ontario",
    description: "Ontario tobacco tax filing obligation for applicable interjurisdictional transport activity.",
    frequencyOptions: ["monthly"],
    defaultFrequency: "monthly",
    accountLabel: "Ontario Tobacco Tax Account / Permit Number",
    accountRequired: true,
  },
]

/* =========================================================
   HELPERS
========================================================= */

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

function getDefinition(code: TaxCode) {
  return TAX_DEFINITIONS.find((item) => item.code === code)!
}

function formatFrequency(value: FilingFrequency) {
  switch (value) {
    case "monthly": return "Monthly"
    case "quarterly": return "Quarterly"
    case "annual": return "Annual"
    case "event-based": return "Event-based"
    case "historical-only": return "Historical only"
    default: return "Not set"
  }
}

function readCompanies(): Company[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadCompanySettings(companyId: string): CompanySettings {
  try {
    const raw = localStorage.getItem(`${SETTINGS_STORAGE_PREFIX}${companyId}`)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function getTaxApplicability(companyId: string, taxCode: TaxCode): RuleValue {
  const settings = loadCompanySettings(companyId)
  return settings.rules?.[taxCode] ?? "not-configured"
}

function loadTaxData(companyId: string): TaxData {
  try {
    const raw = localStorage.getItem(`${TAX_STORAGE_PREFIX}${companyId}`)
    if (!raw) return EMPTY_DATA

    const parsed = JSON.parse(raw)
    return {
      ...EMPTY_DATA,
      ...parsed,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      obligations: Array.isArray(parsed.obligations) ? parsed.obligations : [],
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
    }
  } catch {
    return EMPTY_DATA
  }
}

function saveTaxData(companyId: string, data: TaxData) {
  localStorage.setItem(`${TAX_STORAGE_PREFIX}${companyId}`, JSON.stringify(data))
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function toISODate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function endOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0)
}

function isWeekend(date: Date) {
  return date.getDay() === 0 || date.getDay() === 6
}

/*
  Central business-day adjustment.
  Phase 1 handles weekends.
  Jurisdiction-specific holiday calendars can be plugged into this
  helper later without rewriting each tax definition.
*/
function adjustToNextBusinessDay(date: Date) {
  const adjusted = new Date(date)
  while (isWeekend(adjusted)) {
    adjusted.setDate(adjusted.getDate() + 1)
  }
  return adjusted
}

function monthlyPeriod(year: number, monthIndex: number) {
  const start = new Date(year, monthIndex, 1)
  const end = endOfMonth(year, monthIndex)
  const nominalDue = endOfMonth(year, monthIndex + 1)
  const due = adjustToNextBusinessDay(nominalDue)

  return {
    label: start.toLocaleString("en-US", { month: "long", year: "numeric" }),
    start: toISODate(start),
    end: toISODate(end),
    nominalDue: toISODate(nominalDue),
    due: toISODate(due),
  }
}

function quarterlyPeriod(year: number, quarter: 1 | 2 | 3 | 4) {
  const startMonth = (quarter - 1) * 3
  const start = new Date(year, startMonth, 1)
  const end = endOfMonth(year, startMonth + 2)

  const dueMonth = startMonth + 3
  const dueYear = year + Math.floor(dueMonth / 12)
  const normalizedDueMonth = dueMonth % 12
  const nominalDue = endOfMonth(dueYear, normalizedDueMonth)
  const due = adjustToNextBusinessDay(nominalDue)

  return {
    label: `Q${quarter} ${year}`,
    start: toISODate(start),
    end: toISODate(end),
    nominalDue: toISODate(nominalDue),
    due: toISODate(due),
  }
}

function annualPeriod(year: number) {
  const start = new Date(year, 0, 1)
  const end = new Date(year, 11, 31)
  const nominalDue = new Date(year + 1, 0, 31)
  const due = adjustToNextBusinessDay(nominalDue)

  return {
    label: `${year}`,
    start: toISODate(start),
    end: toISODate(end),
    nominalDue: toISODate(nominalDue),
    due: toISODate(due),
  }
}

function getCurrentAssignment(profile: TaxProfile) {
  if (profile.frequencyHistory.length === 0) return undefined

  return [...profile.frequencyHistory].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom)
  )[0]
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/* =========================================================
   DOCUMENT VIEWER
========================================================= */

function DocumentViewer({
  document,
  onClose,
}: {
  document: TaxDocument
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef({ active: false, x: 0, y: 0 })
  const isPdf = document.mimeType === "application/pdf"

  const fullscreen = async () => {
    if (!rootRef.current) return

    try {
      if (!window.document.fullscreenElement) {
        await rootRef.current.requestFullscreen()
      } else {
        await window.document.exitFullscreen()
      }
    } catch {
      // Browser may block fullscreen in some contexts.
    }
  }

  return (
    <div ref={rootRef} className="fixed inset-0 z-[180] flex flex-col bg-background">
      <div className="flex min-h-14 items-center justify-between border-b px-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Original Document</p>
          <p className="max-w-[650px] truncate text-[10px] text-muted-foreground">
            {document.fileName}
          </p>
        </div>

        <div className="flex items-center gap-1">
          {!isPdf && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setZoom((current) => Math.max(0.5, current - 0.25))}
              >
                <ZoomOut className="size-4" />
              </Button>

              <span className="w-12 text-center text-[10px]">
                {Math.round(zoom * 100)}%
              </span>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setZoom((current) => Math.min(5, current + 0.25))}
              >
                <ZoomIn className="size-4" />
              </Button>
            </>
          )}

          <Button variant="ghost" size="icon" onClick={fullscreen}>
            <Maximize2 className="size-4" />
          </Button>

          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-muted/15">
        {isPdf ? (
          <embed
            src={document.dataUrl}
            type="application/pdf"
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <div
            className="absolute inset-0 flex cursor-grab items-center justify-center overflow-hidden p-5 active:cursor-grabbing"
            style={{ touchAction: "none" }}
            onPointerDown={(event) => {
              dragRef.current = {
                active: true,
                x: event.clientX,
                y: event.clientY,
              }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!dragRef.current.active) return

              const dx = event.clientX - dragRef.current.x
              const dy = event.clientY - dragRef.current.y
              dragRef.current.x = event.clientX
              dragRef.current.y = event.clientY

              setPan((current) => ({
                x: current.x + dx,
                y: current.y + dy,
              }))
            }}
            onPointerUp={() => {
              dragRef.current.active = false
            }}
          >
            <img
              src={document.dataUrl}
              alt={document.fileName}
              draggable={false}
              className="max-h-full max-w-full select-none object-contain shadow-sm"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/* =========================================================
   PROFILE FORM
========================================================= */

function TaxProfileForm({
  profile,
  definition,
  onChange,
}: {
  profile: TaxProfile
  definition: TaxDefinition
  onChange: (profile: TaxProfile) => void
}) {
  const patch = (value: Partial<TaxProfile>) => {
    onChange({ ...profile, ...value, updatedAt: isoNow() })
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label>Tax Type</Label>
        <Input value={definition.name} readOnly className="bg-muted/30" />
      </div>

      <div className="space-y-2">
        <Label>Jurisdiction</Label>
        <Input value={definition.jurisdiction} readOnly className="bg-muted/30" />
      </div>

      <div className="space-y-2">
        <Label>
          {definition.accountLabel}
          {definition.accountRequired ? " *" : ""}
        </Label>
        <Input
          value={profile.accountNumber || ""}
          onChange={(event) => patch({ accountNumber: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Account Status *</Label>
        <Select
          value={profile.accountStatus}
          onValueChange={(value) =>
            patch({ accountStatus: value as TaxProfileStatus })
          }
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Suspended">Suspended</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
            <SelectItem value="Closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Filing Frequency *</Label>
        <Select
          value={profile.filingFrequency}
          onValueChange={(value) =>
            patch({ filingFrequency: value as FilingFrequency })
          }
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {definition.frequencyOptions.map((frequency) => (
              <SelectItem key={frequency} value={frequency}>
                {formatFrequency(frequency)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] leading-4 text-muted-foreground">
          Current frequency in force for this company.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Effective Date</Label>
        <Input
          type="date"
          value={profile.effectiveDate || ""}
          onChange={(event) => patch({ effectiveDate: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Closure Date</Label>
        <Input
          type="date"
          value={profile.closureDate || ""}
          onChange={(event) => patch({ closureDate: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Verification Source</Label>
        <Select
          value={profile.verificationSource || undefined}
          onValueChange={(value) =>
            patch({ verificationSource: value as VerificationSource })
          }
        >
          <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Government Portal">Government Portal</SelectItem>
            <SelectItem value="Official Notice">Official Notice</SelectItem>
            <SelectItem value="Permit / Registration">Permit / Registration</SelectItem>
            <SelectItem value="Filed Return">Filed Return</SelectItem>
            <SelectItem value="Client Instruction">Client Instruction</SelectItem>
            <SelectItem value="Other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Verification Reference</Label>
        <Input
          value={profile.verificationReference || ""}
          onChange={(event) =>
            patch({ verificationReference: event.target.value })
          }
        />
      </div>

      <div className="space-y-2">
        <Label>Last Verified Date</Label>
        <Input
          type="date"
          value={profile.lastVerifiedDate || ""}
          onChange={(event) => patch({ lastVerifiedDate: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Last Verified By</Label>
        <Input
          value={profile.lastVerifiedBy || ""}
          onChange={(event) => patch({ lastVerifiedBy: event.target.value })}
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <Label>Notes</Label>
        <Input
          value={profile.notes || ""}
          onChange={(event) => patch({ notes: event.target.value })}
        />
      </div>
    </div>
  )
}

/* =========================================================
   FREQUENCY HISTORY FORM
========================================================= */

function FrequencyAssignmentForm({
  definition,
  onSave,
  onCancel,
}: {
  definition: TaxDefinition
  onSave: (assignment: FrequencyAssignment) => void
  onCancel: () => void
}) {
  const [frequency, setFrequency] = useState<FilingFrequency>(definition.defaultFrequency)
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO())
  const [assignmentType, setAssignmentType] = useState<AssignmentType>("Authority Assigned")
  const [source, setSource] = useState<VerificationSource>("")
  const [sourceReference, setSourceReference] = useState("")
  const [notes, setNotes] = useState("")

  const save = () => {
    if (!effectiveFrom) return

    onSave({
      id: createId("FREQ"),
      frequency,
      effectiveFrom,
      assignmentType,
      source,
      sourceReference,
      notes,
      verifiedDate: source ? todayISO() : undefined,
      createdAt: isoNow(),
    })
  }

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="mb-4">
        <p className="text-sm font-semibold">Add Filing Frequency Assignment</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Frequency changes are effective-dated. Existing filing periods never change.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Filing Frequency *</Label>
          <Select
            value={frequency}
            onValueChange={(value) => setFrequency(value as FilingFrequency)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {definition.frequencyOptions.map((item) => (
                <SelectItem key={item} value={item}>
                  {formatFrequency(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Effective From *</Label>
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Assignment Type</Label>
          <Select
            value={assignmentType}
            onValueChange={(value) => setAssignmentType(value as AssignmentType)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Regulatory Default">Regulatory Default</SelectItem>
              <SelectItem value="Authority Assigned">Authority Assigned</SelectItem>
              <SelectItem value="Company Elected">Company Elected</SelectItem>
              <SelectItem value="Manual Override">Manual Override</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Verification Source</Label>
          <Select
            value={source || undefined}
            onValueChange={(value) => setSource(value as VerificationSource)}
          >
            <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Government Portal">Government Portal</SelectItem>
              <SelectItem value="Official Notice">Official Notice</SelectItem>
              <SelectItem value="Permit / Registration">Permit / Registration</SelectItem>
              <SelectItem value="Filed Return">Filed Return</SelectItem>
              <SelectItem value="Client Instruction">Client Instruction</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Source Reference</Label>
          <Input
            value={sourceReference}
            onChange={(event) => setSourceReference(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Notes</Label>
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={save}>
          <Check className="mr-2 size-4" /> Save Frequency
        </Button>
      </div>
    </div>
  )
}

/* =========================================================
   FILING RECORD FORM
========================================================= */

function FilingRecordForm({
  obligation,
  existingSubmission,
  onSave,
  onCancel,
}: {
  obligation: FilingObligation
  existingSubmission?: FilingSubmission
  onSave: (submission: FilingSubmission) => void
  onCancel: () => void
}) {
  const [returnType, setReturnType] = useState<ReturnType>(
    existingSubmission?.returnType || "Not Determined"
  )
  const [filingMethod, setFilingMethod] = useState<FilingMethod>(
    existingSubmission?.filingMethod || "Online"
  )
  const [filingDate, setFilingDate] = useState(existingSubmission?.filingDate || "")
  const [amountDue, setAmountDue] = useState(existingSubmission?.amountDue || "")
  const [amountPaid, setAmountPaid] = useState(existingSubmission?.amountPaid || "")
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    existingSubmission?.paymentStatus || "Pending"
  )
  const [confirmationNumber, setConfirmationNumber] = useState(
    existingSubmission?.confirmationNumber || ""
  )
  const [notes, setNotes] = useState(existingSubmission?.notes || "")

  const save = () => {
    const now = isoNow()

    onSave({
      id: existingSubmission?.id || createId("SUB"),
      obligationId: obligation.id,
      returnType,
      filingMethod,
      filingDate,
      amountDue,
      amountPaid,
      paymentStatus,
      confirmationNumber,
      notes,
      createdAt: existingSubmission?.createdAt || now,
      updatedAt: now,
    })
  }

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="mb-4">
        <p className="text-sm font-semibold">Filing Record</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {obligation.reportingPeriodLabel} · due {obligation.dueDate}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Return Type</Label>
          <Select
            value={returnType}
            onValueChange={(value) => setReturnType(value as ReturnType)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Activity Return">Activity Return</SelectItem>
              <SelectItem value="Zero Return">Zero Return</SelectItem>
              <SelectItem value="Final Return">Final Return</SelectItem>
              <SelectItem value="Amended / Corrective Return">Amended / Corrective Return</SelectItem>
              <SelectItem value="No Return Required">No Return Required</SelectItem>
              <SelectItem value="Not Determined">Not Determined</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Filing Method</Label>
          <Select
            value={filingMethod}
            onValueChange={(value) => setFilingMethod(value as FilingMethod)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Online">Online</SelectItem>
              <SelectItem value="Paper">Paper</SelectItem>
              <SelectItem value="Amended / Corrective Filing">Amended / Corrective Filing</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Filing Date</Label>
          <Input
            type="date"
            value={filingDate}
            onChange={(event) => setFilingDate(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Confirmation Number</Label>
          <Input
            value={confirmationNumber}
            onChange={(event) => setConfirmationNumber(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Amount Due</Label>
          <Input
            value={amountDue}
            onChange={(event) => setAmountDue(event.target.value)}
            placeholder="$0.00"
          />
        </div>

        <div className="space-y-2">
          <Label>Amount Paid</Label>
          <Input
            value={amountPaid}
            onChange={(event) => setAmountPaid(event.target.value)}
            placeholder="$0.00"
          />
        </div>

        <div className="space-y-2">
          <Label>Payment Status</Label>
          <Select
            value={paymentStatus}
            onValueChange={(value) => setPaymentStatus(value as PaymentStatus)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Not Applicable">Not Applicable</SelectItem>
              <SelectItem value="Unpaid">Unpaid</SelectItem>
              <SelectItem value="Partially Paid">Partially Paid</SelectItem>
              <SelectItem value="Paid">Paid</SelectItem>
              <SelectItem value="Refund">Refund</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Notes</Label>
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={save}>
          <Check className="mr-2 size-4" /> Save Filing Record
        </Button>
      </div>
    </div>
  )
}

/* =========================================================
   PAGE
========================================================= */

export default function TaxFilingsPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<TaxData>(EMPTY_DATA)
  const [activeTab, setActiveTab] = useState<"profiles" | "calendar" | "records">("profiles")
  const [selectedTaxCode, setSelectedTaxCode] = useState<TaxCode | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [profileDraft, setProfileDraft] = useState<TaxProfile | null>(null)
  const [showFrequencyForm, setShowFrequencyForm] = useState(false)
  const [selectedObligationId, setSelectedObligationId] = useState<string | null>(null)
  const [editingSubmission, setEditingSubmission] = useState<FilingSubmission | undefined>(undefined)
  const [showFilingForm, setShowFilingForm] = useState(false)
  const [uploadContext, setUploadContext] = useState<{
    documentType: TaxDocument["documentType"]
    taxCode?: TaxCode
    profileId?: string
    obligationId?: string
    submissionId?: string
  } | null>(null)
  const [previewDocument, setPreviewDocument] = useState<TaxDocument | null>(null)
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear())

  useEffect(() => {
    const found = readCompanies().find((item) => item.id === companyId)
    setCompany(found || null)
    setData(loadTaxData(companyId))
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    if (!loading) saveTaxData(companyId, data)
  }, [companyId, data, loading])

  const applicableDefinitions = useMemo(
    () =>
      TAX_DEFINITIONS.map((definition) => ({
        definition,
        applicability: getTaxApplicability(companyId, definition.code),
      })),
    [companyId, data]
  )

  const appliedDefinitions = applicableDefinitions.filter(
    (item) => item.applicability === "applies"
  )

  const notConfiguredDefinitions = applicableDefinitions.filter(
    (item) => item.applicability === "not-configured"
  )

  const profileByCode = (taxCode: TaxCode) =>
    data.profiles.find((profile) => profile.taxCode === taxCode)

  const selectedObligation = selectedObligationId
    ? data.obligations.find((item) => item.id === selectedObligationId)
    : undefined

  const submissionsForObligation = (obligationId: string) =>
    data.submissions.filter((item) => item.obligationId === obligationId)

  const openProfile = (taxCode: TaxCode) => {
    const definition = getDefinition(taxCode)
    const existing = profileByCode(taxCode)

    if (existing) {
      setSelectedProfileId(existing.id)
      setProfileDraft({
        ...existing,
        frequencyHistory: [...existing.frequencyHistory],
      })
      setSelectedTaxCode(taxCode)
      return
    }

    const now = isoNow()
    const draft: TaxProfile = {
      id: createId("TAX"),
      taxCode,
      accountStatus: "Pending",
      filingFrequency: definition.defaultFrequency,
      frequencyHistory: [],
      effectiveDate: "",
      closureDate: "",
      verificationSource: "",
      createdAt: now,
      updatedAt: now,
    }

    setSelectedTaxCode(taxCode)
    setSelectedProfileId(draft.id)
    setProfileDraft(draft)
  }

  const saveProfile = () => {
    if (!profileDraft) return

    const definition = getDefinition(profileDraft.taxCode)
    if (definition.accountRequired && !profileDraft.accountNumber?.trim()) {
      window.alert(`${definition.accountLabel} is required.`)
      return
    }

    const existing = data.profiles.some((profile) => profile.id === profileDraft.id)

    setData((current) => ({
      ...current,
      profiles: existing
        ? current.profiles.map((profile) =>
            profile.id === profileDraft.id
              ? { ...profileDraft, updatedAt: isoNow() }
              : profile
          )
        : [{ ...profileDraft, updatedAt: isoNow() }, ...current.profiles],
    }))

    setSelectedProfileId(profileDraft.id)
  }

  const addFrequencyAssignment = (assignment: FrequencyAssignment) => {
    if (!profileDraft) return

    const history = [...profileDraft.frequencyHistory]
    const previous = [...history]
      .filter((item) => item.effectiveFrom < assignment.effectiveFrom)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]

    if (previous && !previous.effectiveTo) {
      const dayBefore = parseDate(assignment.effectiveFrom)
      dayBefore.setDate(dayBefore.getDate() - 1)
      previous.effectiveTo = toISODate(dayBefore)
    }

    setProfileDraft({
      ...profileDraft,
      filingFrequency: assignment.frequency,
      frequencyHistory: [...history, assignment],
      updatedAt: isoNow(),
    })

    setShowFrequencyForm(false)
  }

  const generateObligations = (profile: TaxProfile, year: number) => {
    if (profile.accountStatus === "Closed" || profile.accountStatus === "Inactive") return

    if (
      profile.filingFrequency === "historical-only" ||
      profile.filingFrequency === "event-based" ||
      profile.filingFrequency === "not-set"
    ) {
      window.alert(
        `${formatFrequency(profile.filingFrequency)} obligations are not auto-generated. Add the specific period manually when required.`
      )
      return
    }

    const currentAssignment = getCurrentAssignment(profile)
    const periods: {
      label: string
      start: string
      end: string
      nominalDue: string
      due: string
    }[] = []

    if (profile.filingFrequency === "monthly") {
      for (let month = 0; month < 12; month++) {
        periods.push(monthlyPeriod(year, month))
      }
    }

    if (profile.filingFrequency === "quarterly") {
      ;([1, 2, 3, 4] as const).forEach((quarter) =>
        periods.push(quarterlyPeriod(year, quarter))
      )
    }

    if (profile.filingFrequency === "annual") {
      periods.push(annualPeriod(year))
    }

    const effective = profile.effectiveDate || ""
    const closure = profile.closureDate || ""

    const filtered = periods.filter((period) => {
      if (effective && period.end < effective) return false
      if (closure && period.start > closure) return false
      return true
    })

    setData((current) => {
      const existingKeys = new Set(
        current.obligations
          .filter((item) => item.taxProfileId === profile.id)
          .map((item) => `${item.reportingPeriodStart}|${item.reportingPeriodEnd}`)
      )

      const now = isoNow()
      const newItems = filtered
        .filter(
          (period) => !existingKeys.has(`${period.start}|${period.end}`)
        )
        .map(
          (period): FilingObligation => ({
            id: createId("OBL"),
            taxProfileId: profile.id,
            taxCode: profile.taxCode,
            frequencySnapshot: profile.filingFrequency,
            reportingPeriodLabel: period.label,
            reportingPeriodStart: period.start,
            reportingPeriodEnd: period.end,
            nominalDueDate: period.nominalDue,
            dueDate: period.due,
            status: "Not Started",
            profileUpdatedAtSnapshot: profile.updatedAt,
            frequencyAssignmentId: currentAssignment?.id,
            createdAt: now,
            updatedAt: now,
          })
        )

      return {
        ...current,
        obligations: [...newItems, ...current.obligations],
      }
    })
  }

  const createManualObligation = (profile: TaxProfile) => {
    const start = window.prompt("Reporting period start (YYYY-MM-DD)")
    if (!start) return

    const end = window.prompt("Reporting period end (YYYY-MM-DD)")
    if (!end) return

    const due = window.prompt("Due date (YYYY-MM-DD)")
    if (!due) return

    const label =
      window.prompt("Reporting period label", `${start} – ${end}`) ||
      `${start} – ${end}`

    const now = isoNow()
    const currentAssignment = getCurrentAssignment(profile)

    const obligation: FilingObligation = {
      id: createId("OBL"),
      taxProfileId: profile.id,
      taxCode: profile.taxCode,
      frequencySnapshot: profile.filingFrequency,
      reportingPeriodLabel: label,
      reportingPeriodStart: start,
      reportingPeriodEnd: end,
      nominalDueDate: due,
      dueDate: due,
      status: "Not Started",
      profileUpdatedAtSnapshot: profile.updatedAt,
      frequencyAssignmentId: currentAssignment?.id,
      createdAt: now,
      updatedAt: now,
    }

    setData((current) => ({
      ...current,
      obligations: [obligation, ...current.obligations],
    }))
  }

  const saveSubmission = (submission: FilingSubmission) => {
    setData((current) => {
      const exists = current.submissions.some((item) => item.id === submission.id)

      const nextSubmissions = exists
        ? current.submissions.map((item) =>
            item.id === submission.id ? submission : item
          )
        : [submission, ...current.submissions]

      const nextObligations = current.obligations.map((obligation) => {
        if (obligation.id !== submission.obligationId) return obligation

        let status: FilingStatus = obligation.status

        if (submission.returnType === "No Return Required") {
          status = "No Return Required"
        } else if (
          submission.filingDate &&
          (submission.paymentStatus === "Paid" ||
            submission.paymentStatus === "Not Applicable" ||
            submission.paymentStatus === "Refund")
        ) {
          status = "Completed"
        } else if (submission.filingDate) {
          status = "Payment Pending"
        }

        return { ...obligation, status, updatedAt: isoNow() }
      })

      return {
        ...current,
        submissions: nextSubmissions,
        obligations: nextObligations,
      }
    })

    setShowFilingForm(false)
    setEditingSubmission(undefined)
  }

  const startUpload = (context: typeof uploadContext) => {
    setUploadContext(context)
    fileInputRef.current?.click()
  }

  const handleFile = async (file: File) => {
    if (!uploadContext) return

    const dataUrl = await readFileAsDataUrl(file)
    const document: TaxDocument = {
      id: createId("DOC"),
      fileName: file.name,
      mimeType: file.type,
      dataUrl,
      documentType: uploadContext.documentType,
      taxCode: uploadContext.taxCode,
      profileId: uploadContext.profileId,
      obligationId: uploadContext.obligationId,
      submissionId: uploadContext.submissionId,
      documentDate: todayISO(),
      uploadedAt: isoNow(),
    }

    setData((current) => ({
      ...current,
      documents: [document, ...current.documents],
    }))

    setUploadContext(null)
  }

  const displayedObligations = useMemo(
    () => [...data.obligations].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [data.obligations]
  )

  const getDisplayStatus = (obligation: FilingObligation): FilingStatus => {
    if (
      obligation.status === "Completed" ||
      obligation.status === "No Return Required"
    ) {
      return obligation.status
    }

    return obligation.dueDate < todayISO() ? "Overdue" : obligation.status
  }

  const statusClass = (status: FilingStatus) => {
    switch (status) {
      case "Completed":
        return "border-emerald-200 bg-emerald-50 text-emerald-800"
      case "Filed":
      case "Payment Pending":
        return "border-blue-200 bg-blue-50 text-blue-800"
      case "Ready to File":
        return "border-amber-200 bg-amber-50 text-amber-800"
      case "Overdue":
        return "border-red-500 bg-red-50 text-red-800"
      case "No Return Required":
        return "border-slate-200 bg-slate-50 text-slate-700"
      default:
        return "border-slate-200 bg-background text-slate-700"
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Building2 className="size-10 text-muted-foreground/40" />
        <h2 className="text-lg font-semibold">Company Not Found</h2>
        <Button variant="outline" onClick={() => router.push("/companies")}>
          <ArrowLeft className="mr-2 size-4" /> Companies
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="flex max-w-[1600px] flex-col gap-6 pb-12">
        {/* HEADER */}
        <div>
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push(`/companies/${company.id}/profile`)}
            >
              <ArrowLeft className="size-4" />
            </Button>

            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">Tax Filing</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {company.name} <span className="font-mono text-xs">({company.id})</span>
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Registered Origin
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {company.regCorpState || "Unknown"}, {company.regCorpCountry || "Unknown"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Operating Region
                </p>
                <p className="mt-1 text-sm font-semibold">{company.region || "Not recorded"}</p>
              </div>

              <div className="hidden h-8 w-px bg-border lg:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Applicable Taxes
                </p>
                <p className="mt-1 text-sm font-semibold">{appliedDefinitions.length}</p>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Not Configured
                </p>
                <p className="mt-1 text-sm font-semibold">{notConfiguredDefinitions.length}</p>
              </div>
            </div>
          </div>
        </div>

        {notConfiguredDefinitions.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="flex items-start gap-3 p-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900">
                  Tax applicability is incomplete
                </p>
                <p className="mt-1 text-xs leading-5 text-amber-900/70">
                  {notConfiguredDefinitions.length} tax setting
                  {notConfiguredDefinitions.length === 1 ? "" : "s"} still have no Yes/No decision in Company Settings.
                </p>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => router.push(`/companies/${company.id}/settings`)}
              >
                <Settings2 className="mr-2 size-4" /> Company Settings
              </Button>
            </CardContent>
          </Card>
        )}

        {/* TABS */}
        <div className="flex gap-1 rounded-lg border bg-muted/20 p-1">
          {([
            { id: "profiles", label: "Tax Profile", icon: Landmark },
            { id: "calendar", label: "Filing Calendar", icon: CalendarDays },
            { id: "records", label: "Filing Records", icon: Receipt },
          ] as const).map((item) => {
            const Icon = item.icon
            const active = activeTab === item.id

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm transition-colors ${
                  active
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-4" /> {item.label}
              </button>
            )
          })}
        </div>

        {/* TAX PROFILE */}
        {activeTab === "profiles" && (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-base">Applicable Tax Programs</CardTitle>
                <CardDescription>
                  Company Settings decides Yes / No. This page stores the persistent tax setup only for applicable taxes.
                </CardDescription>
              </CardHeader>

              <CardContent className="p-0">
                {appliedDefinitions.length === 0 ? (
                  <div className="p-10 text-center">
                    <Landmark className="mx-auto size-9 text-muted-foreground/30" />
                    <p className="mt-3 text-sm font-medium">No tax programs are currently marked Applies.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => router.push(`/companies/${company.id}/settings`)}
                    >
                      Open Company Settings
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y">
                    {appliedDefinitions.map(({ definition }) => {
                      const profile = profileByCode(definition.code)

                      return (
                        <button
                          key={definition.code}
                          type="button"
                          onClick={() => openProfile(definition.code)}
                          className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
                            selectedTaxCode === definition.code
                              ? "bg-primary/[0.04]"
                              : "hover:bg-muted/25"
                          }`}
                        >
                          <div className="md:col-span-4">
                            <p className="text-sm font-semibold">{definition.name}</p>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {definition.jurisdiction}
                            </p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Account</p>
                            <p className="mt-1 select-text font-mono text-xs">
                              {profile?.accountNumber || "Not configured"}
                            </p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Frequency</p>
                            <p className="mt-1 text-xs font-medium">
                              {profile
                                ? formatFrequency(profile.filingFrequency)
                                : formatFrequency(definition.defaultFrequency)}
                            </p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</p>
                            <p className="mt-1 text-xs font-medium">
                              {profile?.accountStatus || "Needs setup"}
                            </p>
                          </div>

                          <div className="flex items-center justify-end md:col-span-2">
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="xl:sticky xl:top-6">
              {!profileDraft || !selectedTaxCode ? (
                <Card className="border-dashed">
                  <CardContent className="flex min-h-[540px] flex-col items-center justify-center p-8 text-center">
                    <Landmark className="size-10 text-muted-foreground/30" />
                    <p className="mt-4 text-sm font-medium">Select a tax profile</p>
                    <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted-foreground">
                      Review the company-specific account, filing frequency, status and verification details.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader className="border-b bg-primary/[0.03]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">
                          {getDefinition(selectedTaxCode).shortName}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {getDefinition(selectedTaxCode).description}
                        </CardDescription>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setProfileDraft(null)
                          setSelectedTaxCode(null)
                          setSelectedProfileId(null)
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-5 pt-5">
                    <TaxProfileForm
                      profile={profileDraft}
                      definition={getDefinition(selectedTaxCode)}
                      onChange={setProfileDraft}
                    />

                    <div className="border-t pt-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold">Filing Frequency History</p>
                          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                            Frequency changes are effective-dated and never rewrite historical filings.
                          </p>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowFrequencyForm(true)}
                        >
                          <Plus className="mr-1.5 size-3.5" /> Add Change
                        </Button>
                      </div>

                      {showFrequencyForm && (
                        <div className="mt-4">
                          <FrequencyAssignmentForm
                            definition={getDefinition(selectedTaxCode)}
                            onSave={addFrequencyAssignment}
                            onCancel={() => setShowFrequencyForm(false)}
                          />
                        </div>
                      )}

                      <div className="mt-4 space-y-2">
                        {profileDraft.frequencyHistory.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                            No frequency-change history recorded yet.
                          </div>
                        ) : (
                          [...profileDraft.frequencyHistory]
                            .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
                            .map((assignment) => (
                              <div key={assignment.id} className="rounded-lg border p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold">
                                      {formatFrequency(assignment.frequency)}
                                    </p>
                                    <p className="mt-1 text-[10px] text-muted-foreground">
                                      {assignment.effectiveFrom}
                                      {assignment.effectiveTo
                                        ? ` → ${assignment.effectiveTo}`
                                        : " → Current"}
                                    </p>
                                  </div>
                                  <Badge variant="outline">{assignment.assignmentType}</Badge>
                                </div>

                                {(assignment.source || assignment.sourceReference) && (
                                  <p className="mt-2 text-[10px] text-muted-foreground">
                                    {assignment.source}
                                    {assignment.sourceReference ? ` · ${assignment.sourceReference}` : ""}
                                  </p>
                                )}
                              </div>
                            ))
                        )}
                      </div>
                    </div>

                    <div className="border-t pt-5">
                      <div className="flex gap-2">
                        <Button className="flex-1" onClick={saveProfile}>
                          <Check className="mr-2 size-4" /> Save Tax Profile
                        </Button>

                        <Button
                          variant="outline"
                          onClick={() =>
                            startUpload({
                              documentType: "Registration",
                              taxCode: profileDraft.taxCode,
                              profileId: profileDraft.id,
                            })
                          }
                        >
                          <Upload className="mr-2 size-4" /> Evidence
                        </Button>
                      </div>

                      {data.profiles.some((profile) => profile.id === profileDraft.id) && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <Button
                            variant="outline"
                            onClick={() => generateObligations(profileDraft, calendarYear)}
                          >
                            <CalendarDays className="mr-2 size-4" /> Generate {calendarYear}
                          </Button>

                          <Button
                            variant="outline"
                            onClick={() => createManualObligation(profileDraft)}
                          >
                            <Plus className="mr-2 size-4" /> Manual Period
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="border-t pt-5">
                      <p className="text-xs font-semibold">Profile Evidence</p>
                      <div className="mt-3 space-y-2">
                        {data.documents.filter((document) => document.profileId === profileDraft.id).length === 0 ? (
                          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                            No profile evidence uploaded.
                          </div>
                        ) : (
                          data.documents
                            .filter((document) => document.profileId === profileDraft.id)
                            .map((document) => (
                              <button
                                key={document.id}
                                type="button"
                                onClick={() => setPreviewDocument(document)}
                                className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/30"
                              >
                                <FileText className="mt-0.5 size-4 text-primary" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-medium">{document.fileName}</p>
                                  <p className="mt-1 text-[10px] text-muted-foreground">
                                    {document.documentType} · {document.documentDate || document.uploadedAt.slice(0, 10)}
                                  </p>
                                </div>
                              </button>
                            ))
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* FILING CALENDAR */}
        {activeTab === "calendar" && (
          <div className="space-y-6">
            <Card>
              <CardHeader className="border-b">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="text-base">Filing Calendar</CardTitle>
                    <CardDescription>
                      One obligation per reporting period. Frequency and due-date data are snapshotted when the period is created.
                    </CardDescription>
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      className="w-28"
                      value={calendarYear}
                      onChange={(event) =>
                        setCalendarYear(Number(event.target.value) || new Date().getFullYear())
                      }
                    />

                    <Button
                      variant="outline"
                      onClick={() =>
                        data.profiles
                          .filter((profile) => profile.accountStatus === "Active")
                          .forEach((profile) => generateObligations(profile, calendarYear))
                      }
                    >
                      <RefreshCcw className="mr-2 size-4" /> Generate Active
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {displayedObligations.length === 0 ? (
                  <div className="p-10 text-center">
                    <CalendarDays className="mx-auto size-9 text-muted-foreground/30" />
                    <p className="mt-3 text-sm font-medium">No filing obligations generated yet.</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {displayedObligations.map((obligation) => {
                      const definition = getDefinition(obligation.taxCode)
                      const status = getDisplayStatus(obligation)
                      const submissionCount = submissionsForObligation(obligation.id).length

                      return (
                        <button
                          key={obligation.id}
                          type="button"
                          onClick={() => {
                            setSelectedObligationId(obligation.id)
                            setShowFilingForm(false)
                          }}
                          className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
                            selectedObligationId === obligation.id
                              ? "bg-primary/[0.04]"
                              : "hover:bg-muted/25"
                          }`}
                        >
                          <div className="md:col-span-3">
                            <p className="text-sm font-semibold">{definition.shortName}</p>
                            <p className="mt-1 text-[10px] text-muted-foreground">{definition.jurisdiction}</p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Period</p>
                            <p className="mt-1 text-xs font-medium">{obligation.reportingPeriodLabel}</p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Frequency</p>
                            <p className="mt-1 text-xs">{formatFrequency(obligation.frequencySnapshot)}</p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Due Date</p>
                            <p className="mt-1 text-xs font-medium">{obligation.dueDate}</p>
                          </div>

                          <div className="md:col-span-2">
                            <Badge variant="outline" className={statusClass(status)}>{status}</Badge>
                          </div>

                          <div className="flex items-center justify-end gap-2 md:col-span-1">
                            {submissionCount > 0 && <Badge variant="secondary">{submissionCount}</Badge>}
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {selectedObligation && (
              <Card>
                <CardHeader className="border-b bg-primary/[0.03]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">
                        {getDefinition(selectedObligation.taxCode).name}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {selectedObligation.reportingPeriodLabel}
                      </CardDescription>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setSelectedObligationId(null)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5 pt-5">
                  <div className="grid gap-4 md:grid-cols-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Period Start</p>
                      <p className="mt-1 select-text text-xs font-medium">{selectedObligation.reportingPeriodStart}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Period End</p>
                      <p className="mt-1 select-text text-xs font-medium">{selectedObligation.reportingPeriodEnd}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Nominal Due</p>
                      <p className="mt-1 select-text text-xs font-medium">{selectedObligation.nominalDueDate}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Adjusted Due</p>
                      <p className="mt-1 select-text text-xs font-medium">{selectedObligation.dueDate}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-[10px] leading-5 text-muted-foreground">
                      Frequency snapshot: <span className="font-medium text-foreground">{formatFrequency(selectedObligation.frequencySnapshot)}</span>. Historical periods remain unchanged if the company is later reassigned to another frequency.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        setEditingSubmission(undefined)
                        setShowFilingForm(true)
                      }}
                    >
                      <Plus className="mr-2 size-4" /> Add Filing
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() =>
                        startUpload({
                          documentType: "Supporting Document",
                          taxCode: selectedObligation.taxCode,
                          obligationId: selectedObligation.id,
                        })
                      }
                    >
                      <Upload className="mr-2 size-4" /> Add Supporting Document
                    </Button>
                  </div>

                  {showFilingForm && (
                    <FilingRecordForm
                      obligation={selectedObligation}
                      existingSubmission={editingSubmission}
                      onSave={saveSubmission}
                      onCancel={() => {
                        setShowFilingForm(false)
                        setEditingSubmission(undefined)
                      }}
                    />
                  )}

                  <div className="border-t pt-5">
                    <p className="text-xs font-semibold">Submission History</p>
                    <div className="mt-3 space-y-2">
                      {submissionsForObligation(selectedObligation.id).length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                          No filing submission recorded yet.
                        </div>
                      ) : (
                        submissionsForObligation(selectedObligation.id).map((submission) => (
                          <div key={submission.id} className="rounded-lg border p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold">{submission.returnType}</p>
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  {submission.filingMethod}{submission.filingDate ? ` · ${submission.filingDate}` : ""}
                                </p>
                              </div>

                              <div className="flex items-center gap-2">
                                <Badge variant="outline">{submission.paymentStatus}</Badge>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  onClick={() => {
                                    setEditingSubmission(submission)
                                    setShowFilingForm(true)
                                  }}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount Due</p>
                                <p className="mt-1 select-text text-xs font-medium">{submission.amountDue || "—"}</p>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount Paid</p>
                                <p className="mt-1 select-text text-xs font-medium">{submission.amountPaid || "—"}</p>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Confirmation</p>
                                <p className="mt-1 select-text text-xs font-medium">{submission.confirmationNumber || "—"}</p>
                              </div>
                            </div>

                            <div className="mt-3 flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  startUpload({
                                    documentType: "Filing Receipt",
                                    taxCode: selectedObligation.taxCode,
                                    obligationId: selectedObligation.id,
                                    submissionId: submission.id,
                                  })
                                }
                              >
                                <Upload className="mr-2 size-3.5" /> Filing Receipt
                              </Button>

                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  startUpload({
                                    documentType: "Payment Receipt",
                                    taxCode: selectedObligation.taxCode,
                                    obligationId: selectedObligation.id,
                                    submissionId: submission.id,
                                  })
                                }
                              >
                                <Upload className="mr-2 size-3.5" /> Payment Receipt
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="border-t pt-5">
                    <p className="text-xs font-semibold">Documents</p>
                    <div className="mt-3 space-y-2">
                      {data.documents.filter((document) => document.obligationId === selectedObligation.id).length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                          No documents attached to this filing period.
                        </div>
                      ) : (
                        data.documents
                          .filter((document) => document.obligationId === selectedObligation.id)
                          .map((document) => (
                            <button
                              key={document.id}
                              type="button"
                              onClick={() => setPreviewDocument(document)}
                              className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/30"
                            >
                              <FileText className="mt-0.5 size-4 text-primary" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium">{document.fileName}</p>
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  {document.documentType} · {document.documentDate || document.uploadedAt.slice(0, 10)}
                                </p>
                              </div>
                            </button>
                          ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* FILING RECORDS */}
        {activeTab === "records" && (
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Filing Records</CardTitle>
              <CardDescription>Historical submission records across all applicable taxes.</CardDescription>
            </CardHeader>

            <CardContent className="p-0">
              {data.submissions.length === 0 ? (
                <div className="p-10 text-center">
                  <Receipt className="mx-auto size-9 text-muted-foreground/30" />
                  <p className="mt-3 text-sm font-medium">No tax filings recorded yet.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {data.submissions.map((submission) => {
                    const obligation = data.obligations.find(
                      (item) => item.id === submission.obligationId
                    )
                    if (!obligation) return null

                    const definition = getDefinition(obligation.taxCode)

                    return (
                      <button
                        key={submission.id}
                        type="button"
                        onClick={() => {
                          setActiveTab("calendar")
                          setSelectedObligationId(obligation.id)
                        }}
                        className="grid w-full gap-4 p-4 text-left transition-colors hover:bg-muted/25 md:grid-cols-12"
                      >
                        <div className="md:col-span-3">
                          <p className="text-sm font-semibold">{definition.shortName}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">{obligation.reportingPeriodLabel}</p>
                        </div>

                        <div className="md:col-span-2">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Return Type</p>
                          <p className="mt-1 text-xs">{submission.returnType}</p>
                        </div>

                        <div className="md:col-span-2">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Filed</p>
                          <p className="mt-1 text-xs">{submission.filingDate || "—"}</p>
                        </div>

                        <div className="md:col-span-2">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount Due</p>
                          <p className="mt-1 select-text text-xs font-medium">{submission.amountDue || "—"}</p>
                        </div>

                        <div className="md:col-span-2">
                          <Badge variant="outline">{submission.paymentStatus}</Badge>
                        </div>

                        <div className="flex justify-end md:col-span-1">
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          await handleFile(file)
        }}
      />

      {previewDocument && (
        <DocumentViewer
          document={previewDocument}
          onClose={() => setPreviewDocument(null)}
        />
      )}
    </>
  )
}
