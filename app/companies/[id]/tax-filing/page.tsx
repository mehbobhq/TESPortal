"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
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
  Pencil,
  Plus,
  Receipt,
  RefreshCcw,
  Settings2,
  Upload,
  X,
} from "lucide-react"

import { recordAuditEvent } from "@/lib/audit-logger"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer"
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker"
import { UnsavedChangesPrompt } from "@/src/components/shared/UnsavedChangesPrompt"
import { EmptyState, LoadingState } from "@/src/components/shared/StateDisplays"

/* =========================================================
   TYPES — LOCKED STORAGE CONTRACT (DATA_VERSION = 1)
========================================================= */

type Company = {
  id: string
  name: string
  regCorpState?: string
  regCorpCountry?: string
  region?: string
  accIfta?: string
  accCt?: string
  accNyhut?: string
  accKyu?: string
  accNm?: string
  accOr?: string
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
  companyField?: "accIfta" | "accCt" | "accNyhut" | "accKyu" | "accNm" | "accOr"
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
    accountLabel: "Account Number",
    accountRequired: true,
    companyField: "accIfta",
  },
  {
    code: "ct_huf",
    name: "Connecticut Highway Use Fee",
    shortName: "CT HUF",
    jurisdiction: "Connecticut",
    description: "Connecticut highway-use filing obligation for applicable carriers.",
    frequencyOptions: ["quarterly"],
    defaultFrequency: "quarterly",
    accountLabel: "Account Number",
    accountRequired: true,
    companyField: "accCt",
  },
  {
    code: "ny_hut",
    name: "New York Highway Use Tax",
    shortName: "NY HUT",
    jurisdiction: "New York",
    description: "Current filing frequency is company-specific and can move between quarterly and annual.",
    frequencyOptions: ["quarterly", "annual"],
    defaultFrequency: "quarterly",
    accountLabel: "Account Number",
    accountRequired: true,
    companyField: "accNyhut",
  },
  {
    code: "kyu",
    name: "Kentucky Weight Distance Tax / KYU",
    shortName: "KYU",
    jurisdiction: "Kentucky",
    description: "Kentucky weight-distance filing obligation for applicable carriers.",
    frequencyOptions: ["quarterly"],
    defaultFrequency: "quarterly",
    accountLabel: "Account Number",
    accountRequired: true,
    companyField: "accKyu",
  },
  {
    code: "nm_wdt",
    name: "New Mexico Weight Distance Tax",
    shortName: "NM WDT",
    jurisdiction: "New Mexico",
    description: "New Mexico weight-distance filing obligation for applicable carriers.",
    frequencyOptions: ["quarterly"],
    defaultFrequency: "quarterly",
    accountLabel: "Account Number",
    accountRequired: true,
    companyField: "accNm",
  },
  {
    code: "or_wmt",
    name: "Oregon Weight-Mile Tax",
    shortName: "OR WMT",
    jurisdiction: "Oregon",
    description: "Current company frequency may be monthly or quarterly.",
    frequencyOptions: ["monthly", "quarterly"],
    defaultFrequency: "monthly",
    accountLabel: "Account Number",
    accountRequired: true,
    companyField: "accOr",
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
   HELPERS & REUSABLE LOGIC
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

function getDefinition(code: TaxCode): TaxDefinition {
  return TAX_DEFINITIONS.find((item) => item.code === code) || TAX_DEFINITIONS[0]
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

function writeCompanies(companies: Company[]) {
  localStorage.setItem("tes_companies", JSON.stringify(companies))
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

function normalizeAccountNumber(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function getCompanyAccountNumber(company: Company, definition: TaxDefinition): string {
  if (!definition.companyField) return ""
  const value = company[definition.companyField]
  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

function findGlobalAccountConflict(companyId: string, taxCode: TaxCode, accountNumber: string) {
  const normalized = normalizeAccountNumber(accountNumber)
  if (!normalized) return undefined

  const definition = getDefinition(taxCode)
  const companies = readCompanies()

  for (const otherCompany of companies) {
    if (otherCompany.id === companyId) continue
    const otherValue = getCompanyAccountNumber(otherCompany, definition)
    if (normalizeAccountNumber(otherValue) === normalized) return otherCompany
  }

  for (const otherCompany of companies) {
    if (otherCompany.id === companyId) continue
    const otherData = loadTaxData(otherCompany.id)
    const conflict = otherData.profiles.find(
      (profile) =>
        profile.taxCode === taxCode &&
        profile.accountStatus !== "Closed" &&
        profile.accountStatus !== "Inactive" &&
        normalizeAccountNumber(profile.accountNumber || "") === normalized
    )
    if (conflict) return otherCompany
  }

  return undefined
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
  Weekend adjustment (rolling forward Saturday/Sunday to Monday).
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

function getFrequencyAssignmentForDate(profile: TaxProfile, date: string) {
  return [...profile.frequencyHistory]
    .filter((assignment) => assignment.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
}

function getFrequencyForDate(profile: TaxProfile, date: string) {
  return getFrequencyAssignmentForDate(profile, date)?.frequency || profile.filingFrequency
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
   FORMS: PROFILE, FREQUENCY, FILING
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
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Tax Program</label>
        <input
          type="text"
          value={definition.name}
          readOnly
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-muted/30 font-medium text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Jurisdiction</label>
        <input
          type="text"
          value={definition.jurisdiction}
          readOnly
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-muted/30 text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">
          {definition.accountLabel}{definition.accountRequired ? " *" : ""}
        </label>
        <input
          type="text"
          value={profile.accountNumber || ""}
          placeholder="Enter account / permit number"
          onChange={(event) => patch({ accountNumber: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Account Status *</label>
        <select
          value={profile.accountStatus}
          onChange={(e) => patch({ accountStatus: e.target.value as TaxProfileStatus })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        >
          <option value="Active">Active</option>
          <option value="Pending">Pending</option>
          <option value="Suspended">Suspended</option>
          <option value="Inactive">Inactive</option>
          <option value="Closed">Closed</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Current Filing Frequency</label>
        <div className="flex h-9 items-center rounded-lg border border-border bg-muted/30 px-3 text-xs font-medium text-foreground">
          {formatFrequency(profile.filingFrequency)}
        </div>
        <p className="text-[10px] leading-4 text-muted-foreground">
          Filing frequency is effective-dated. To change frequency, add an entry under Frequency History so prior periods remain immutable.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Effective Date</label>
        <input
          type="date"
          value={profile.effectiveDate || ""}
          onChange={(event) => patch({ effectiveDate: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Closure Date</label>
        <input
          type="date"
          value={profile.closureDate || ""}
          onChange={(event) => patch({ closureDate: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Verification Source</label>
        <select
          value={profile.verificationSource || ""}
          onChange={(e) => patch({ verificationSource: e.target.value as VerificationSource })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        >
          <option value="">Select verification source</option>
          <option value="Government Portal">Government Portal</option>
          <option value="Official Notice">Official Notice</option>
          <option value="Permit / Registration">Permit / Registration</option>
          <option value="Filed Return">Filed Return</option>
          <option value="Client Instruction">Client Instruction</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Verification Reference</label>
        <input
          type="text"
          value={profile.verificationReference || ""}
          placeholder="Confirmation / Letter ID"
          onChange={(event) => patch({ verificationReference: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Last Verified Date</label>
        <input
          type="date"
          value={profile.lastVerifiedDate || ""}
          onChange={(event) => patch({ lastVerifiedDate: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Last Verified By</label>
        <input
          type="text"
          value={profile.lastVerifiedBy || ""}
          placeholder="Verifier name / officer"
          onChange={(event) => patch({ lastVerifiedBy: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5 md:col-span-2">
        <label className="text-xs font-semibold text-foreground">Notes</label>
        <input
          type="text"
          value={profile.notes || ""}
          placeholder="Additional operational or jurisdiction notes"
          onChange={(event) => patch({ notes: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>
    </div>
  )
}

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
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="mb-4">
        <p className="text-sm font-semibold text-foreground">Add Filing Frequency Assignment</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Frequency changes are effective-dated. Prior reporting periods and historical obligations remain immutable.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Filing Frequency *</label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as FilingFrequency)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            {definition.frequencyOptions.map((item) => (
              <option key={item} value={item}>
                {formatFrequency(item)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Effective From *</label>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Assignment Type</label>
          <select
            value={assignmentType}
            onChange={(e) => setAssignmentType(e.target.value as AssignmentType)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            <option value="Regulatory Default">Regulatory Default</option>
            <option value="Authority Assigned">Authority Assigned</option>
            <option value="Company Elected">Company Elected</option>
            <option value="Manual Override">Manual Override</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Verification Source</label>
          <select
            value={source || ""}
            onChange={(e) => setSource(e.target.value as VerificationSource)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            <option value="">Select source</option>
            <option value="Government Portal">Government Portal</option>
            <option value="Official Notice">Official Notice</option>
            <option value="Permit / Registration">Permit / Registration</option>
            <option value="Filed Return">Filed Return</option>
            <option value="Client Instruction">Client Instruction</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Source Reference</label>
          <input
            type="text"
            value={sourceReference}
            placeholder="Notice ID / Docket Number"
            onChange={(event) => setSourceReference(event.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Notes</label>
          <input
            type="text"
            value={notes}
            placeholder="Assignment rationale"
            onChange={(event) => setNotes(event.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
        >
          <Check className="size-3.5" /> Save Frequency
        </button>
      </div>
    </div>
  )
}

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
    existingSubmission?.returnType || "Activity Return"
  )
  const [filingMethod, setFilingMethod] = useState<FilingMethod>(
    existingSubmission?.filingMethod || "Online"
  )
  const [filingDate, setFilingDate] = useState(existingSubmission?.filingDate || todayISO())
  const [amountDue, setAmountDue] = useState(existingSubmission?.amountDue || "")
  const [amountPaid, setAmountPaid] = useState(existingSubmission?.amountPaid || "")
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    existingSubmission?.paymentStatus || "Paid"
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
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="mb-4">
        <p className="text-sm font-semibold text-foreground">
          {existingSubmission ? "Edit Filing Submission" : "Record Filing Submission"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {obligation.reportingPeriodLabel} · Due {obligation.dueDate}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Return Type *</label>
          <select
            value={returnType}
            onChange={(e) => setReturnType(e.target.value as ReturnType)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            <option value="Activity Return">Activity Return</option>
            <option value="Zero Return">Zero Return</option>
            <option value="Final Return">Final Return</option>
            <option value="Amended / Corrective Return">Amended / Corrective Return</option>
            <option value="No Return Required">No Return Required</option>
            <option value="Not Determined">Not Determined</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Filing Method</label>
          <select
            value={filingMethod}
            onChange={(e) => setFilingMethod(e.target.value as FilingMethod)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            <option value="Online">Online</option>
            <option value="Paper">Paper</option>
            <option value="Amended / Corrective Filing">Amended / Corrective Filing</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Filing Date</label>
          <input
            type="date"
            value={filingDate}
            onChange={(event) => setFilingDate(event.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Confirmation / Reference Number</label>
          <input
            type="text"
            value={confirmationNumber}
            placeholder="e.g. TX-2026-89412"
            onChange={(event) => setConfirmationNumber(event.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Amount Due</label>
          <input
            type="text"
            value={amountDue}
            onChange={(event) => setAmountDue(event.target.value)}
            placeholder="$0.00"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Amount Paid</label>
          <input
            type="text"
            value={amountPaid}
            onChange={(event) => setAmountPaid(event.target.value)}
            placeholder="$0.00"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Payment Status</label>
          <select
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            <option value="Not Applicable">Not Applicable</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Partially Paid">Partially Paid</option>
            <option value="Paid">Paid</option>
            <option value="Refund">Refund</option>
            <option value="Pending">Pending</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Notes</label>
          <input
            type="text"
            value={notes}
            placeholder="Filing notes, payment checks, confirmation remarks"
            onChange={(event) => setNotes(event.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
        >
          <Check className="size-3.5" /> Save Filing Record
        </button>
      </div>
    </div>
  )
}

/* =========================================================
   MAIN COMPONENT: TaxFilingsPage
========================================================= */

export default function TaxFilingsPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string

  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<TaxData>(EMPTY_DATA)
  const [activeTab, setActiveTab] = useState<"profiles" | "calendar" | "records">("profiles")
  const [selectedTaxCode, setSelectedTaxCode] = useState<TaxCode | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [profileDraft, setProfileDraft] = useState<TaxProfile | null>(null)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
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
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const autoGeneratedRef = useRef(false)

  // 1. Initial Data Hydration
  useEffect(() => {
    const found = readCompanies().find((item) => item.id === companyId)
    setCompany(found || null)
    setData(loadTaxData(companyId))
    setLoading(false)
  }, [companyId])

  // 2. Initial Active Profile Generation (once per mount)
  useEffect(() => {
    if (loading || !companyId || autoGeneratedRef.current) return
    autoGeneratedRef.current = true

    const activeProfiles = data.profiles.filter((profile) => profile.accountStatus === "Active")
    activeProfiles.forEach((profile) => generateObligations(profile, new Date().getFullYear()))
  }, [loading, companyId, data.profiles])

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

  // Open / Select Tax Profile
  const openProfile = (taxCode: TaxCode) => {
    const definition = getDefinition(taxCode)
    const existing = profileByCode(taxCode)

    if (existing) {
      const canonicalAccount = getCompanyAccountNumber(company || ({} as Company), definition)
      const hydrated: TaxProfile = {
        ...existing,
        accountNumber: canonicalAccount || existing.accountNumber || undefined,
        frequencyHistory: [...existing.frequencyHistory],
      }
      setSelectedProfileId(existing.id)
      setProfileDraft(hydrated)
      setSelectedTaxCode(taxCode)
      setIsEditingProfile(false)
      setShowFrequencyForm(false)
      return
    }

    const now = isoNow()
    const canonicalAccount = getCompanyAccountNumber(company || ({} as Company), definition)
    const initialFrequency: FrequencyAssignment = {
      id: createId("FREQ"),
      frequency: definition.defaultFrequency,
      effectiveFrom: todayISO(),
      assignmentType: "Regulatory Default",
      source: "",
      createdAt: now,
    }
    const draft: TaxProfile = {
      id: createId("TAX"),
      taxCode,
      accountNumber: canonicalAccount || undefined,
      accountStatus: "Pending",
      filingFrequency: definition.defaultFrequency,
      frequencyHistory: [initialFrequency],
      effectiveDate: todayISO(),
      closureDate: "",
      verificationSource: "",
      createdAt: now,
      updatedAt: now,
    }

    setSelectedTaxCode(taxCode)
    setSelectedProfileId(draft.id)
    setProfileDraft(draft)
    setIsEditingProfile(true)
    setShowFrequencyForm(false)
  }

  // Controlled Cross-Store Save with Rollback Protection
  const saveProfile = () => {
    if (!profileDraft) return

    const definition = getDefinition(profileDraft.taxCode)

    // 1. Validate required fields
    if (definition.accountRequired && !profileDraft.accountNumber?.trim()) {
      window.alert(`Account Number is required for ${definition.name}.`)
      return
    }

    // 2. Global Duplicate Collision Check
    const conflict = profileDraft.accountNumber
      ? findGlobalAccountConflict(companyId, profileDraft.taxCode, profileDraft.accountNumber)
      : undefined
    if (conflict) {
      window.alert(
        `This Account Number is already registered to another company (${conflict.name}). The tax profile was not saved to protect global identifier integrity.`
      )
      return
    }

    // 3. Pre-Mutation Snapshots
    const preTaxDataSnapshot = JSON.parse(JSON.stringify(data)) as TaxData
    const preCompaniesSnapshot = readCompanies()
    const preCompanyState = company ? { ...company } : null
    const isNew = !data.profiles.some((p) => p.id === profileDraft.id)
    const previousProfile = data.profiles.find((p) => p.id === profileDraft.id)

    const profileToSave: TaxProfile = {
      ...profileDraft,
      frequencyHistory:
        profileDraft.frequencyHistory.length > 0
          ? profileDraft.frequencyHistory
          : [
              {
                id: createId("FREQ"),
                frequency: profileDraft.filingFrequency,
                effectiveFrom: profileDraft.effectiveDate || todayISO(),
                assignmentType: "Manual Override",
                source: "",
                createdAt: isoNow(),
              },
            ],
      updatedAt: isoNow(),
    }

    const frequencyChanged = previousProfile
      ? JSON.stringify(previousProfile.frequencyHistory) !== JSON.stringify(profileToSave.frequencyHistory)
      : false

    try {
      // 4. Update Tax Store
      const updatedProfiles = isNew
        ? [profileToSave, ...data.profiles]
        : data.profiles.map((p) => (p.id === profileToSave.id ? profileToSave : p))
      const nextTaxData: TaxData = { ...data, profiles: updatedProfiles }
      saveTaxData(companyId, nextTaxData)

      // 5. Synchronize Mapped Company Master Account Field
      if (definition.companyField) {
        const nextCompanies = preCompaniesSnapshot.map((item) =>
          item.id === companyId
            ? { ...item, [definition.companyField!]: (profileToSave.accountNumber || "").trim() }
            : item
        )
        writeCompanies(nextCompanies)
      }

      // 6. Record Audit Event (Only after both storage operations succeed)
      recordAuditEvent({
        companyId,
        actor: "",
        role: "",
        entityType: "TaxFiling",
        entityId: profileToSave.id,
        action: isNew ? "CREATE" : "UPDATE",
        details: `${isNew ? "Created" : "Updated"} tax profile for ${definition.shortName} (${profileToSave.accountStatus}, Account: ${profileToSave.accountNumber || "None"})${frequencyChanged ? " [Filing frequency history updated]" : ""}`,
        oldValue: previousProfile
          ? JSON.stringify({
              taxCode: previousProfile.taxCode,
              accountNumber: previousProfile.accountNumber,
              accountStatus: previousProfile.accountStatus,
              filingFrequency: previousProfile.filingFrequency,
              frequencyHistory: previousProfile.frequencyHistory,
            })
          : undefined,
        newValue: JSON.stringify({
          taxCode: profileToSave.taxCode,
          accountNumber: profileToSave.accountNumber,
          accountStatus: profileToSave.accountStatus,
          filingFrequency: profileToSave.filingFrequency,
          frequencyHistory: profileToSave.frequencyHistory,
        }),
      })

      // 7. Commit React UI State
      setData(nextTaxData)
      if (company && definition.companyField) {
        setCompany({ ...company, [definition.companyField]: profileToSave.accountNumber || "" })
      }
      setSelectedProfileId(profileToSave.id)
      setProfileDraft(profileToSave)
      setIsEditingProfile(false)

      if (profileToSave.accountStatus === "Active") {
        generateObligations(profileToSave, new Date().getFullYear())
      }
    } catch (err) {
      // Rollback on any failure
      saveTaxData(companyId, preTaxDataSnapshot)
      writeCompanies(preCompaniesSnapshot)
      setData(preTaxDataSnapshot)
      setCompany(preCompanyState)
      window.alert("Failed to save tax profile due to a storage error. Changes were rolled back.")
    }
  }

  // Add Effective-Dated Frequency Assignment (Draft operation - persisted on saveProfile)
  const addFrequencyAssignment = (assignment: FrequencyAssignment) => {
    if (!profileDraft) return

    const history = [...profileDraft.frequencyHistory]
    if (history.some((item) => item.effectiveFrom === assignment.effectiveFrom)) {
      window.alert("A frequency assignment already exists for this effective date.")
      return
    }

    const previous = [...history]
      .filter((item) => item.effectiveFrom < assignment.effectiveFrom)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]

    if (previous && !previous.effectiveTo) {
      const dayBefore = parseDate(assignment.effectiveFrom)
      dayBefore.setDate(dayBefore.getDate() - 1)
      previous.effectiveTo = toISODate(dayBefore)
    }

    const updatedProfile: TaxProfile = {
      ...profileDraft,
      filingFrequency: assignment.frequency,
      frequencyHistory: [...history, assignment],
      updatedAt: isoNow(),
    }

    setProfileDraft(updatedProfile)
    setShowFrequencyForm(false)
  }

  // Obligation Generation (Respects Effective Dating and Avoids Duplicates - Persist First)
  const generateObligations = (profile: TaxProfile, year: number) => {
    if (profile.accountStatus === "Closed" || profile.accountStatus === "Inactive") return

    const candidates: {
      label: string
      start: string
      end: string
      nominalDue: string
      due: string
      frequency: FilingFrequency
      assignmentId?: string
    }[] = []

    const effective = profile.effectiveDate || ""
    const closure = profile.closureDate || ""

    const addPeriod = (
      period: { label: string; start: string; end: string; nominalDue: string; due: string },
      frequency: FilingFrequency
    ) => {
      if (effective && period.end < effective) return
      if (closure && period.start > closure) return
      const assignment = getFrequencyAssignmentForDate(profile, period.start)
      candidates.push({ ...period, frequency, assignmentId: assignment?.id })
    }

    // Monthly evaluation across 12 months
    for (let month = 0; month < 12; month++) {
      const monthStart = toISODate(new Date(year, month, 1))
      const frequency = getFrequencyForDate(profile, monthStart)
      if (frequency === "monthly") addPeriod(monthlyPeriod(year, month), frequency)
    }

    // Quarterly evaluation
    ;([1, 2, 3, 4] as const).forEach((quarter) => {
      const quarterStart = toISODate(new Date(year, (quarter - 1) * 3, 1))
      const frequency = getFrequencyForDate(profile, quarterStart)
      if (frequency === "quarterly") addPeriod(quarterlyPeriod(year, quarter), frequency)
    })

    // Annual evaluation
    const annualFrequency = getFrequencyForDate(profile, `${year}-01-01`)
    if (annualFrequency === "annual") addPeriod(annualPeriod(year), annualFrequency)

    const currentTaxData = loadTaxData(companyId)
    const existingKeys = new Set(
      currentTaxData.obligations
        .filter((item) => item.taxProfileId === profile.id)
        .map((item) => `${item.reportingPeriodStart}|${item.reportingPeriodEnd}`)
    )

    const now = isoNow()
    const newItems = candidates
      .filter((period) => !existingKeys.has(`${period.start}|${period.end}`))
      .map(
        (period): FilingObligation => ({
          id: createId("OBL"),
          taxProfileId: profile.id,
          taxCode: profile.taxCode,
          frequencySnapshot: period.frequency,
          reportingPeriodLabel: period.label,
          reportingPeriodStart: period.start,
          reportingPeriodEnd: period.end,
          nominalDueDate: period.nominalDue,
          dueDate: period.due,
          status: "Not Started",
          profileUpdatedAtSnapshot: profile.updatedAt,
          frequencyAssignmentId: period.assignmentId,
          createdAt: now,
          updatedAt: now,
        })
      )

    if (newItems.length === 0) return

    const nextTaxData: TaxData = {
      ...currentTaxData,
      obligations: [...newItems, ...currentTaxData.obligations],
    }

    try {
      saveTaxData(companyId, nextTaxData)
      setData(nextTaxData)

      // Audit only newly created and successfully persisted obligations
      newItems.forEach((obl) => {
        recordAuditEvent({
          companyId,
          actor: "",
          role: "",
          entityType: "TaxFiling",
          entityId: obl.id,
          action: "CREATE",
          details: `Generated filing obligation for ${obl.taxCode.toUpperCase()} (${obl.reportingPeriodLabel}, Due: ${obl.dueDate})`,
        })
      })
    } catch (err) {
      window.alert("Failed to save generated obligations due to a storage error.")
    }
  }

  // Create Manual Obligation (Persist First)
  const createManualObligation = (profile: TaxProfile) => {
    const start = window.prompt("Reporting period start (YYYY-MM-DD):")
    if (!start) return
    const end = window.prompt("Reporting period end (YYYY-MM-DD):")
    if (!end) return
    const due = window.prompt("Due date (YYYY-MM-DD):")
    if (!due) return
    const label = window.prompt("Reporting period label:", `${start} – ${end}`) || `${start} – ${end}`

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

    const currentTaxData = loadTaxData(companyId)
    const nextTaxData: TaxData = {
      ...currentTaxData,
      obligations: [obligation, ...currentTaxData.obligations],
    }

    try {
      saveTaxData(companyId, nextTaxData)
      setData(nextTaxData)

      recordAuditEvent({
        companyId,
        actor: "",
        role: "",
        entityType: "TaxFiling",
        entityId: obligation.id,
        action: "CREATE",
        details: `Manually created tax filing obligation ${obligation.reportingPeriodLabel} for ${profile.taxCode.toUpperCase()}`,
      })
    } catch (err) {
      window.alert("Failed to save manual obligation due to a storage error.")
    }
  }

  // Save / Update Submission (Persist First)
  const saveSubmission = (submission: FilingSubmission) => {
    const currentTaxData = loadTaxData(companyId)
    const isNew = !currentTaxData.submissions.some((item) => item.id === submission.id)
    const previousSubmission = currentTaxData.submissions.find((item) => item.id === submission.id)

    const nextSubmissions = isNew
      ? [submission, ...currentTaxData.submissions]
      : currentTaxData.submissions.map((item) => (item.id === submission.id ? submission : item))

    const nextObligations = currentTaxData.obligations.map((obligation) => {
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

    const nextTaxData: TaxData = {
      ...currentTaxData,
      submissions: nextSubmissions,
      obligations: nextObligations,
    }

    try {
      saveTaxData(companyId, nextTaxData)
      setData(nextTaxData)

      recordAuditEvent({
        companyId,
        actor: "",
        role: "",
        entityType: "TaxFiling",
        entityId: submission.id,
        action: isNew ? "CREATE" : "UPDATE",
        details: `${isNew ? "Recorded" : "Updated"} filing submission for obligation ${submission.obligationId} (${submission.returnType}, ${submission.filingMethod}, Status: ${submission.paymentStatus})`,
        oldValue: previousSubmission
          ? JSON.stringify({
              returnType: previousSubmission.returnType,
              filingDate: previousSubmission.filingDate,
              amountDue: previousSubmission.amountDue,
              amountPaid: previousSubmission.amountPaid,
              confirmationNumber: previousSubmission.confirmationNumber,
              paymentStatus: previousSubmission.paymentStatus,
              filingMethod: previousSubmission.filingMethod,
            })
          : undefined,
        newValue: JSON.stringify({
          returnType: submission.returnType,
          filingDate: submission.filingDate,
          amountDue: submission.amountDue,
          amountPaid: submission.amountPaid,
          confirmationNumber: submission.confirmationNumber,
          paymentStatus: submission.paymentStatus,
          filingMethod: submission.filingMethod,
        }),
      })

      setShowFilingForm(false)
      setEditingSubmission(undefined)
    } catch (err) {
      window.alert("Failed to save filing submission due to a storage error.")
    }
  }

  // Handle Document Ingestion (via DocumentSourcePicker - Persist First)
  const handleSelectFile = async (file: File) => {
    if (!uploadContext) return

    try {
      const dataUrl = await readFileAsDataUrl(file)
      const document: TaxDocument = {
        id: createId("DOC"),
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        dataUrl,
        documentType: uploadContext.documentType,
        taxCode: uploadContext.taxCode,
        profileId: uploadContext.profileId,
        obligationId: uploadContext.obligationId,
        submissionId: uploadContext.submissionId,
        documentDate: todayISO(),
        uploadedAt: isoNow(),
      }

      const currentTaxData = loadTaxData(companyId)
      const nextTaxData: TaxData = {
        ...currentTaxData,
        documents: [document, ...currentTaxData.documents],
      }

      saveTaxData(companyId, nextTaxData)
      setData(nextTaxData)

      recordAuditEvent({
        companyId,
        actor: "",
        role: "",
        entityType: "Evidence",
        entityId: document.id,
        evidenceId: document.id,
        action: "CREATE",
        details: `Attached tax evidence document "${document.fileName}" (${document.documentType}) for ${document.taxCode || "Tax Filing"}`,
      })

      setUploadContext(null)
      setSourcePickerOpen(false)
    } catch (err) {
      window.alert("Failed to attach evidence document due to a storage or file reading error.")
    }
  }

  const startUpload = (context: typeof uploadContext) => {
    setUploadContext(context)
    setSourcePickerOpen(true)
  }

  const displayedObligations = useMemo(
    () => [...data.obligations].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [data.obligations]
  )

  const getDisplayStatus = (obligation: FilingObligation): FilingStatus => {
    if (obligation.status === "Completed" || obligation.status === "No Return Required") {
      return obligation.status
    }
    return obligation.dueDate < todayISO() ? "Overdue" : obligation.status
  }

  const statusBadge = (status: FilingStatus) => {
    switch (status) {
      case "Completed":
        return <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Completed</span>
      case "Filed":
      case "Payment Pending":
        return <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">{status}</span>
      case "Ready to File":
        return <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Ready to File</span>
      case "Overdue":
        return <span className="inline-flex items-center rounded-full border border-red-400 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">Overdue</span>
      case "No Return Required":
        return <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">No Return Required</span>
      default:
        return <span className="inline-flex items-center rounded-full border border-slate-200 bg-background px-2 py-0.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">{status}</span>
    }
  }

  if (loading) {
    return <LoadingState message="Loading tax compliance records..." />
  }

  if (!company) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Building2 className="size-10 text-muted-foreground/40" />
        <h2 className="text-lg font-semibold text-foreground">Company Not Found</h2>
        <button
          type="button"
          onClick={() => router.push("/companies")}
          className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
        >
          <ArrowLeft className="size-4" /> Return to Companies
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex max-w-[1600px] flex-col gap-6 pb-12">
        {/* HEADER & OPERATIONAL SUMMARY */}
        <div>
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => router.push(`/companies/${company.id}/profile`)}
              aria-label="Back to Company Profile"
              className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-4" />
            </button>

            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Tax Filing</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {company.name} <span className="font-mono text-xs">({company.id})</span>
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-xs">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <ReadOnlyField
                label="Registered Origin"
                value={`${company.regCorpState || "Unknown"}, ${company.regCorpCountry || "Unknown"}`}
              />
              <ReadOnlyField
                label="Operating Region"
                value={company.region || "Not recorded"}
              />
              <ReadOnlyField
                label="Applicable Taxes"
                value={appliedDefinitions.length}
              />
              <ReadOnlyField
                label="Not Configured"
                value={notConfiguredDefinitions.length}
                badge={
                  notConfiguredDefinitions.length > 0 ? (
                    <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      Action Required
                    </span>
                  ) : undefined
                }
              />
            </div>
          </div>
        </div>

        {/* INCOMPLETE APPLICABILITY WARNING */}
        {notConfiguredDefinitions.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-xs dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    Tax applicability is incomplete
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-900/70 dark:text-amber-300/70">
                    {notConfiguredDefinitions.length} tax program
                    {notConfiguredDefinitions.length === 1 ? "" : "s"} still require a Yes / No determination in Company Settings.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => router.push(`/companies/${company.id}/settings`)}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-100/50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200 transition-colors"
              >
                <Settings2 className="size-3.5" /> Company Settings
              </button>
            </div>
          </div>
        )}

        {/* TABS */}
        <div className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
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
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  active
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-4" /> {item.label}
              </button>
            )
          })}
        </div>

        {/* TAB 1: TAX PROFILE */}
        {activeTab === "profiles" && (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_480px]">
            <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
              <div className="border-b border-border/60 p-5">
                <h3 className="text-base font-bold text-foreground">Applicable Tax Programs</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Applicability is managed in Company Settings. Configure company accounts, filing frequencies, and verification details below.
                </p>
              </div>

              <div>
                {appliedDefinitions.length === 0 ? (
                  <EmptyState
                    icon={<Landmark className="size-8 text-muted-foreground/50" />}
                    title="No Applicable Tax Programs"
                    description="No tax programs are currently marked 'Applies' for this carrier in Company Settings."
                    action={{
                      label: "Open Company Settings",
                      onClick: () => router.push(`/companies/${company.id}/settings`),
                      icon: <Settings2 className="size-3.5" />,
                    }}
                  />
                ) : (
                  <div className="divide-y divide-border/60">
                    {appliedDefinitions.map(({ definition }) => {
                      const profile = profileByCode(definition.code)
                      const isSelected = selectedTaxCode === definition.code

                      return (
                        <button
                          key={definition.code}
                          type="button"
                          onClick={() => openProfile(definition.code)}
                          className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
                            isSelected ? "bg-primary/[0.04]" : "hover:bg-muted/20"
                          }`}
                        >
                          <div className="md:col-span-4 min-w-0">
                            <p className="text-sm font-semibold text-foreground">{definition.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{definition.jurisdiction}</p>
                          </div>

                          <div className="md:col-span-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Account</p>
                            <p className="mt-0.5 font-mono text-xs font-semibold select-text text-foreground">
                              {getCompanyAccountNumber(company, definition) || profile?.accountNumber || "Not configured"}
                            </p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Frequency</p>
                            <p className="mt-0.5 text-xs font-medium text-foreground">
                              {profile
                                ? formatFrequency(profile.filingFrequency)
                                : formatFrequency(definition.defaultFrequency)}
                            </p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</p>
                            <p className="mt-0.5 text-xs font-semibold text-foreground">
                              {profile?.accountStatus || "Needs setup"}
                            </p>
                          </div>

                          <div className="flex items-center justify-end md:col-span-1">
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* DETAIL / EDIT DRAWER */}
            <div className="xl:sticky xl:top-6">
              {!profileDraft || !selectedTaxCode ? (
                <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center min-h-[500px] flex flex-col items-center justify-center">
                  <Landmark className="size-10 text-muted-foreground/30" />
                  <p className="mt-4 text-sm font-semibold text-foreground">Select a tax program</p>
                  <p className="mt-1 max-w-[280px] text-xs leading-relaxed text-muted-foreground">
                    Review registered account numbers, effective-dated frequency history, and attached compliance evidence.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
                  <div className="border-b border-border/60 bg-muted/10 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold text-foreground">
                          {getDefinition(selectedTaxCode).shortName}
                        </h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {getDefinition(selectedTaxCode).description}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setProfileDraft(null)
                          setSelectedTaxCode(null)
                          setSelectedProfileId(null)
                          setIsEditingProfile(false)
                          setShowFrequencyForm(false)
                        }}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-6 p-5">
                    {isEditingProfile ? (
                      <TaxProfileForm
                        profile={profileDraft}
                        definition={getDefinition(selectedTaxCode)}
                        onChange={setProfileDraft}
                      />
                    ) : (
                      /* VIEW MODE: CLEAN DOCUMENT-STYLE LABEL/VALUE TILES */
                      <div className="space-y-5">
                        <div className="grid gap-3.5 md:grid-cols-2">
                          <ReadOnlyField
                            label="Tax Program"
                            value={getDefinition(selectedTaxCode).name}
                          />
                          <ReadOnlyField
                            label="Jurisdiction"
                            value={getDefinition(selectedTaxCode).jurisdiction}
                          />
                          <ReadOnlyField
                            label={getDefinition(selectedTaxCode).accountLabel}
                            value={profileDraft.accountNumber || "Not configured"}
                            mono
                            copyable
                          />
                          <ReadOnlyField
                            label="Account Status"
                            value={profileDraft.accountStatus}
                          />
                          <ReadOnlyField
                            label="Filing Frequency"
                            value={formatFrequency(profileDraft.filingFrequency)}
                            subtext="Current active frequency"
                          />
                          <ReadOnlyField
                            label="Effective Date"
                            value={profileDraft.effectiveDate}
                          />
                          <ReadOnlyField
                            label="Closure Date"
                            value={profileDraft.closureDate}
                          />
                        </div>

                        <div className="border-t border-border/60 pt-4">
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Verification Details
                          </p>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <ReadOnlyField
                              label="Verification Source"
                              value={profileDraft.verificationSource}
                            />
                            <ReadOnlyField
                              label="Verification Reference"
                              value={profileDraft.verificationReference}
                              mono
                            />
                            <ReadOnlyField
                              label="Last Verified Date"
                              value={profileDraft.lastVerifiedDate}
                            />
                            <ReadOnlyField
                              label="Last Verified By"
                              value={profileDraft.lastVerifiedBy}
                            />
                          </div>
                          {profileDraft.notes && (
                            <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-2.5 text-xs text-muted-foreground">
                              {profileDraft.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* FREQUENCY HISTORY (LOCKED IMMUTABILITY) */}
                    <div className="border-t border-border/60 pt-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Filing Frequency History
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            Effective-dated frequency assignments. Existing obligations remain immutable.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setIsEditingProfile(true)
                            setShowFrequencyForm(true)
                          }}
                          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                        >
                          <Plus className="size-3.5" /> Add Change
                        </button>
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

                      <div className="mt-3 space-y-2">
                        {profileDraft.frequencyHistory.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                            No frequency changes recorded yet.
                          </div>
                        ) : (
                          [...profileDraft.frequencyHistory]
                            .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
                            .map((assignment) => (
                              <div key={assignment.id} className="rounded-xl border border-border bg-card p-3 shadow-2xs">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-bold text-foreground">
                                      {formatFrequency(assignment.frequency)}
                                    </p>
                                    <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                                      {assignment.effectiveFrom}
                                      {assignment.effectiveTo
                                        ? ` → ${assignment.effectiveTo}`
                                        : " → Current"}
                                    </p>
                                  </div>
                                  <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground">
                                    {assignment.assignmentType}
                                  </span>
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

                    {/* ACTION CONTROLS */}
                    <div className="border-t border-border/60 pt-5">
                      <div className="flex gap-2">
                        {isEditingProfile ? (
                          <>
                            <button
                              type="button"
                              onClick={saveProfile}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
                            >
                              <Check className="size-4" /> Save Record
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (data.profiles.some((p) => p.id === profileDraft.id)) {
                                  const stored = data.profiles.find((p) => p.id === profileDraft.id)
                                  if (stored) setProfileDraft({ ...stored, frequencyHistory: [...stored.frequencyHistory] })
                                  setIsEditingProfile(false)
                                  setShowFrequencyForm(false)
                                }
                              }}
                              className="rounded-xl border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setIsEditingProfile(true)}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
                          >
                            <Pencil className="size-4" /> Edit Profile
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            startUpload({
                              documentType: "Registration",
                              taxCode: profileDraft.taxCode,
                              profileId: profileDraft.id,
                            })
                          }
                          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                        >
                          <Upload className="size-4" /> Upload Evidence
                        </button>
                      </div>

                      {data.profiles.some((p) => p.id === profileDraft.id) && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => generateObligations(profileDraft, calendarYear)}
                            className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                          >
                            <CalendarDays className="size-3.5" /> Generate {calendarYear}
                          </button>

                          <button
                            type="button"
                            onClick={() => createManualObligation(profileDraft)}
                            className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                          >
                            <Plus className="size-3.5" /> Manual Period
                          </button>
                        </div>
                      )}
                    </div>

                    {/* ATTACHED EVIDENCE (SHARED VIEWER TRIGGER) */}
                    <div className="border-t border-border/60 pt-5">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Attached Tax Evidence
                      </p>
                      <div className="mt-3 space-y-2">
                        {data.documents.filter((doc) => doc.profileId === profileDraft.id).length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                            No registration evidence attached.
                          </div>
                        ) : (
                          data.documents
                            .filter((doc) => doc.profileId === profileDraft.id)
                            .map((doc) => (
                              <button
                                key={doc.id}
                                type="button"
                                onClick={() => setPreviewDocument(doc)}
                                className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted/30"
                              >
                                <FileText className="mt-0.5 size-4 text-primary shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-semibold text-foreground">{doc.fileName}</p>
                                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                                    {doc.documentType} · {doc.documentDate || doc.uploadedAt.slice(0, 10)}
                                  </p>
                                </div>
                              </button>
                            ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: FILING CALENDAR */}
        {activeTab === "calendar" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
              <div className="border-b border-border/60 p-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-base font-bold text-foreground">Filing Obligations Calendar</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Period obligations with snapshotted filing frequencies and business-day adjusted due dates.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="w-28 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      value={calendarYear}
                      onChange={(event) =>
                        setCalendarYear(Number(event.target.value) || new Date().getFullYear())
                      }
                    />

                    <button
                      type="button"
                      onClick={() =>
                        data.profiles
                          .filter((profile) => profile.accountStatus === "Active")
                          .forEach((profile) => generateObligations(profile, calendarYear))
                      }
                      className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                    >
                      <RefreshCcw className="size-3.5" /> Generate Active
                    </button>
                  </div>
                </div>
              </div>

              <div>
                {displayedObligations.length === 0 ? (
                  <EmptyState
                    icon={<CalendarDays className="size-8 text-muted-foreground/50" />}
                    title="No Obligations Generated"
                    description="No filing obligations currently exist for this calendar year. Configure tax profiles and generate active periods."
                  />
                ) : (
                  <div className="divide-y divide-border/60">
                    {displayedObligations.map((obligation) => {
                      const definition = getDefinition(obligation.taxCode)
                      const status = getDisplayStatus(obligation)
                      const submissionCount = submissionsForObligation(obligation.id).length
                      const isSelected = selectedObligationId === obligation.id

                      return (
                        <button
                          key={obligation.id}
                          type="button"
                          onClick={() => {
                            setSelectedObligationId(obligation.id)
                            setShowFilingForm(false)
                          }}
                          className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
                            isSelected ? "bg-primary/[0.04]" : "hover:bg-muted/20"
                          }`}
                        >
                          <div className="md:col-span-3 min-w-0">
                            <p className="text-sm font-semibold text-foreground">{definition.shortName}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{definition.jurisdiction}</p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Period</p>
                            <p className="mt-0.5 text-xs font-semibold text-foreground">{obligation.reportingPeriodLabel}</p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Frequency</p>
                            <p className="mt-0.5 text-xs text-foreground">{formatFrequency(obligation.frequencySnapshot)}</p>
                          </div>

                          <div className="md:col-span-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due Date</p>
                            <p className="mt-0.5 text-xs font-semibold text-foreground">{obligation.dueDate}</p>
                          </div>

                          <div className="md:col-span-2">
                            {statusBadge(status)}
                          </div>

                          <div className="flex items-center justify-end gap-2 md:col-span-1">
                            {submissionCount > 0 && (
                              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                                {submissionCount}
                              </span>
                            )}
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* OBLIGATION DETAIL CARD */}
            {selectedObligation && (
              <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
                <div className="border-b border-border/60 bg-muted/10 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-foreground">
                        {getDefinition(selectedObligation.taxCode).name}
                      </h3>
                      <p className="mt-0.5 text-xs font-semibold text-foreground">
                        {selectedObligation.reportingPeriodLabel} · Due {selectedObligation.dueDate}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedObligationId(null)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-6 p-5">
                  <div className="grid gap-3.5 sm:grid-cols-2 md:grid-cols-4">
                    <ReadOnlyField
                      label="Period Start"
                      value={selectedObligation.reportingPeriodStart}
                    />
                    <ReadOnlyField
                      label="Period End"
                      value={selectedObligation.reportingPeriodEnd}
                    />
                    <ReadOnlyField
                      label="Nominal Due"
                      value={selectedObligation.nominalDueDate}
                    />
                    <ReadOnlyField
                      label="Adjusted Due"
                      value={selectedObligation.dueDate}
                    />
                  </div>

                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                    Frequency snapshot: <span className="font-semibold text-foreground">{formatFrequency(selectedObligation.frequencySnapshot)}</span>. Historical reporting requirements remain permanently preserved.
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSubmission(undefined)
                        setShowFilingForm(true)
                      }}
                      className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
                    >
                      <Plus className="size-3.5" /> Record Filing Submission
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        startUpload({
                          documentType: "Supporting Document",
                          taxCode: selectedObligation.taxCode,
                          obligationId: selectedObligation.id,
                        })
                      }
                      className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                    >
                      <Upload className="size-3.5" /> Attach Supporting Document
                    </button>
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

                  {/* SUBMISSION HISTORY */}
                  <div className="border-t border-border/60 pt-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Submission History
                    </p>
                    <div className="mt-3 space-y-3">
                      {submissionsForObligation(selectedObligation.id).length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                          No filing submission recorded for this obligation.
                        </div>
                      ) : (
                        submissionsForObligation(selectedObligation.id).map((submission) => (
                          <div key={submission.id} className="rounded-xl border border-border bg-card p-4 shadow-2xs">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold text-foreground">{submission.returnType}</p>
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  {submission.filingMethod}{submission.filingDate ? ` · Filed ${submission.filingDate}` : ""}
                                </p>
                              </div>

                              <div className="flex items-center gap-2">
                                <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground">
                                  {submission.paymentStatus}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSubmission(submission)
                                    setShowFilingForm(true)
                                  }}
                                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                              <ReadOnlyField
                                label="Amount Due"
                                value={submission.amountDue}
                              />
                              <ReadOnlyField
                                label="Amount Paid"
                                value={submission.amountPaid}
                              />
                              <ReadOnlyField
                                label="Confirmation Reference"
                                value={submission.confirmationNumber}
                                mono
                                copyable
                              />
                            </div>

                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  startUpload({
                                    documentType: "Filing Receipt",
                                    taxCode: selectedObligation.taxCode,
                                    obligationId: selectedObligation.id,
                                    submissionId: submission.id,
                                  })
                                }
                                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                              >
                                <Upload className="size-3" /> Filing Receipt
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  startUpload({
                                    documentType: "Payment Receipt",
                                    taxCode: selectedObligation.taxCode,
                                    obligationId: selectedObligation.id,
                                    submissionId: submission.id,
                                  })
                                }
                                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                              >
                                <Upload className="size-3" /> Payment Receipt
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* DOCUMENTS LINKED TO OBLIGATION */}
                  <div className="border-t border-border/60 pt-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Attached Period Evidence
                    </p>
                    <div className="mt-3 space-y-2">
                      {data.documents.filter((doc) => doc.obligationId === selectedObligation.id).length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                          No documents attached to this reporting period.
                        </div>
                      ) : (
                        data.documents
                          .filter((doc) => doc.obligationId === selectedObligation.id)
                          .map((doc) => (
                            <button
                              key={doc.id}
                              type="button"
                              onClick={() => setPreviewDocument(doc)}
                              className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted/30"
                            >
                              <FileText className="mt-0.5 size-4 text-primary shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-foreground">{doc.fileName}</p>
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  {doc.documentType} · {doc.documentDate || doc.uploadedAt.slice(0, 10)}
                                </p>
                              </div>
                            </button>
                          ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: FILING RECORDS */}
        {activeTab === "records" && (
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="border-b border-border/60 p-5">
              <h3 className="text-base font-bold text-foreground">Historical Filing Submissions</h3>
              <p className="mt-1 text-xs text-muted-foreground">Master submission register across all applicable tax obligations.</p>
            </div>

            <div>
              {data.submissions.length === 0 ? (
                <EmptyState
                  icon={<Receipt className="size-8 text-muted-foreground/50" />}
                  title="No Filing Records"
                  description="No historical tax submissions have been logged for this carrier yet."
                />
              ) : (
                <div className="divide-y divide-border/60">
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
                          setShowFilingForm(false)
                          setEditingSubmission(undefined)
                        }}
                        className="grid w-full gap-4 p-4 text-left transition-colors hover:bg-muted/20 md:grid-cols-12"
                      >
                        <div className="md:col-span-3 min-w-0">
                          <p className="text-sm font-semibold text-foreground">{definition.shortName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{obligation.reportingPeriodLabel}</p>
                        </div>

                        <div className="md:col-span-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Return Type</p>
                          <p className="mt-0.5 text-xs text-foreground font-medium">{submission.returnType}</p>
                        </div>

                        <div className="md:col-span-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Filed Date</p>
                          <p className="mt-0.5 text-xs text-foreground">{submission.filingDate || "—"}</p>
                        </div>

                        <div className="md:col-span-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Amount Due</p>
                          <p className="mt-0.5 text-xs font-semibold select-text text-foreground">{submission.amountDue || "—"}</p>
                        </div>

                        <div className="md:col-span-2">
                          <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground">
                            {submission.paymentStatus}
                          </span>
                        </div>

                        <div className="flex justify-end md:col-span-1">
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* SHARED FOUNDATION: DOCUMENT SOURCE PICKER */}
      <DocumentSourcePicker
        isOpen={sourcePickerOpen}
        onClose={() => setSourcePickerOpen(false)}
        onSelectFile={handleSelectFile}
        onSelectCamera={() => {
          setSourcePickerOpen(false)
        }}
        title={`Attach Tax Evidence (${uploadContext?.documentType || "Document"})`}
        subtitle="Select document file for secure compliance archive attachment."
        allowedExtensions={[".pdf", ".jpg", ".jpeg", ".png", ".webp"]}
      />

      {/* SHARED FOUNDATION: SECURE DOCUMENT VIEWER */}
      {previewDocument && (
        <SecureDocumentViewer
          fileName={previewDocument.fileName}
          mimeType={previewDocument.mimeType}
          dataUrl={previewDocument.dataUrl}
          documentTitle={`Tax Evidence: ${previewDocument.fileName}`}
          documentDate={previewDocument.documentDate || previewDocument.uploadedAt.slice(0, 10)}
          companyName={company.name}
          companyId={company.id}
          auditEventId={previewDocument.id}
          onClose={() => setPreviewDocument(null)}
        />
      )}

      {/* UNSAVED CHANGES GUARD */}
      <UnsavedChangesPrompt
        hasChanges={isEditingProfile}
        onSave={saveProfile}
        onDiscard={() => {
          if (profileDraft) {
            const stored = data.profiles.find((p) => p.id === profileDraft.id)
            if (stored) {
              setProfileDraft({ ...stored, frequencyHistory: [...stored.frequencyHistory] })
            } else {
              setProfileDraft(null)
              setSelectedTaxCode(null)
              setSelectedProfileId(null)
            }
          }
          setIsEditingProfile(false)
          setShowFrequencyForm(false)
        }}
        message="You have unsaved changes in this tax profile configuration."
      />
    </>
  )
}
