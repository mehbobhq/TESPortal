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
  ArrowLeft,
  Building2,
  CalendarClock,
  Camera,
  CheckCircle2,
  Copy,
  FileCheck2,
  FileText,
  History,
  Landmark,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
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
  kind?: string
  status?: string
  tone?: string

  /*
    DO NOT RENAME.
    These fields are already connected across TES.
  */
  regCorpState?: string
  regCorpCountry?: string
  region?: string

  cargoTypes?: string[]
  cargoInformation?: unknown
  hazmat?: boolean

  [key: string]: any
}

type AuthorityCategory =
  | "canadian"
  | "us_federal"
  | "operating_registration"

type AuthorityType =
  | "PROVINCIAL_CARRIER_IDENTIFIER"
  | "CANADIAN_SAFETY_AUTHORITY"
  | "USDOT"
  | "MC"
  | "MCS150"
  | "UCR"
  | "PHMSA"
  | "OTHER"

type SafetySystem =
  | "CARRIER_PROFILE_CVOR"
  | "SMS_PROFILE"

type SourceType =
  | "OCR"
  | "Manual"

type DocumentSource =
  | "camera"
  | "device"

type AuthorityEvidence = {
  id: string

  recordId?: string

  fileName: string
  mimeType: string
  dataUrl: string

  documentDate: string

  uploadedAt: string

  source: DocumentSource

  ocrConfidence?: number
}

type AuthorityRecord = {
  id: string

  category: AuthorityCategory

  authorityType: AuthorityType

  /*
    Exact display/source wording.
  */
  name: string

  number: string

  issuingAuthority: string

  jurisdictionCode: string
  jurisdictionLabel: string

  country: string

  status:
    | "Active"
    | "Pending"
    | "Inactive"
    | "Suspended"
    | "Expired"

  /*
    Standard authority dates.
  */
  issueDate?: string
  effectiveDate?: string
  expiryDate?: string

  /*
    Periodic event dates.
    MCS-150 uses these instead of meaningless generic dates.
  */
  eventDate?: string
  nextActionDate?: string

  notes?: string

  evidenceIds: string[]

  source: SourceType

  createdAt: string
  updatedAt: string
}

type SafetyRecord = {
  id: string

  system: SafetySystem

  jurisdictionCode: string
  jurisdictionLabel: string

  country: string

  reviewDate: string

  summary: string

  notes?: string

  evidenceIds: string[]

  source: SourceType

  createdAt: string
  updatedAt: string
}

type AuditRecord = {
  id: string

  auditType: string

  regulator: string

  jurisdictionCode: string
  jurisdictionLabel: string

  country: string

  referenceNumber: string

  noticeDate?: string
  dueDate?: string
  completedDate?: string

  status:
    | "Open"
    | "Scheduled"
    | "In Progress"
    | "Completed"
    | "Closed"

  outcome?: string
  score?: string

  followUpRequired: boolean

  followUpDueDate?: string

  notes?: string

  evidenceIds: string[]

  source: SourceType

  createdAt: string
  updatedAt: string
}

type StoredAuthoritiesData = {
  version: number

  authorities: AuthorityRecord[]

  safety: SafetyRecord[]

  audits: AuditRecord[]

  evidence: AuthorityEvidence[]
}

type SelectedRecord =
  | {
      kind: "authority"
      record: AuthorityRecord
    }
  | {
      kind: "safety"
      record: SafetyRecord
    }
  | {
      kind: "audit"
      record: AuditRecord
    }

type AuthorityDraft = {
  category: AuthorityCategory

  authorityType: AuthorityType

  name: string

  number: string

  issuingAuthority: string

  jurisdictionCode: string
  jurisdictionLabel: string

  country: string

  status: AuthorityRecord["status"]

  issueDate: string

  effectiveDate: string

  expiryDate: string

  eventDate: string

  nextActionDate: string

  notes: string
}

type SafetyDraft = {
  system: SafetySystem

  jurisdictionCode: string
  jurisdictionLabel: string

  country: string

  reviewDate: string

  summary: string

  notes: string
}

type AuditDraft = {
  auditType: string

  regulator: string

  jurisdictionCode: string
  jurisdictionLabel: string

  country: string

  referenceNumber: string

  noticeDate: string
  dueDate: string
  completedDate: string

  status: AuditRecord["status"]

  outcome: string

  score: string

  followUpRequired: boolean

  followUpDueDate: string

  notes: string
}

type OCRSession = {
  mode:
    | "authority"
    | "safety"
    | "audit"

  source: DocumentSource

  file: File

  dataUrl: string

  processing: boolean

  extractionComplete: boolean

  confidence?: number

  /*
    Source-document date.
    Used for document history, not merely upload date.
  */
  documentDate: string

  authorityDraft?: AuthorityDraft

  safetyDraft?: SafetyDraft

  auditDraft?: AuditDraft
}

/* =========================================================
   CONSTANTS
========================================================= */

const SYSTEM_SETTINGS_KEY =
  "tes_system_settings"

const THREE_YEAR_HISTORY =
  3

const DEFAULT_DEADLINE_RULES: DeadlineRules = {
  healthyMinDays: 61,

  watchMinDays: 31,

  urgentMinDays: 11,

  criticalMinDays: 0,

  criticalMaxDays: 10,
}

const EMPTY_DATA: StoredAuthoritiesData = {
  version: 3,

  authorities: [],

  safety: [],

  audits: [],

  evidence: [],
}

/* =========================================================
   JURISDICTION MASTER
========================================================= */

type Jurisdiction = {
  code: string

  label: string

  country:
    | "Canada"
    | "United States"

  federal?: boolean
}

const JURISDICTIONS: Jurisdiction[] = [
  {
    code: "CA-FED",
    label: "Federal — Canada",
    country: "Canada",
    federal: true,
  },

  {
    code: "AB",
    label: "Alberta",
    country: "Canada",
  },

  {
    code: "BC",
    label: "British Columbia",
    country: "Canada",
  },

  {
    code: "MB",
    label: "Manitoba",
    country: "Canada",
  },

  {
    code: "NB",
    label: "New Brunswick",
    country: "Canada",
  },

  {
    code: "NL",
    label: "Newfoundland and Labrador",
    country: "Canada",
  },

  {
    code: "NT",
    label: "Northwest Territories",
    country: "Canada",
  },

  {
    code: "NS",
    label: "Nova Scotia",
    country: "Canada",
  },

  {
    code: "NU",
    label: "Nunavut",
    country: "Canada",
  },

  {
    code: "ON",
    label: "Ontario",
    country: "Canada",
  },

  {
    code: "PE",
    label: "Prince Edward Island",
    country: "Canada",
  },

  {
    code: "QC",
    label: "Quebec",
    country: "Canada",
  },

  {
    code: "SK",
    label: "Saskatchewan",
    country: "Canada",
  },

  {
    code: "YT",
    label: "Yukon",
    country: "Canada",
  },

  {
    code: "US-FED",
    label: "Federal — United States",
    country: "United States",
    federal: true,
  },

  {
    code: "AL",
    label: "Alabama",
    country: "United States",
  },

  {
    code: "AK",
    label: "Alaska",
    country: "United States",
  },

  {
    code: "AZ",
    label: "Arizona",
    country: "United States",
  },

  {
    code: "AR",
    label: "Arkansas",
    country: "United States",
  },

  {
    code: "CA",
    label: "California",
    country: "United States",
  },

  {
    code: "CO",
    label: "Colorado",
    country: "United States",
  },

  {
    code: "CT",
    label: "Connecticut",
    country: "United States",
  },

  {
    code: "DE",
    label: "Delaware",
    country: "United States",
  },

  {
    code: "FL",
    label: "Florida",
    country: "United States",
  },

  {
    code: "GA",
    label: "Georgia",
    country: "United States",
  },

  {
    code: "HI",
    label: "Hawaii",
    country: "United States",
  },

  {
    code: "ID",
    label: "Idaho",
    country: "United States",
  },

  {
    code: "IL",
    label: "Illinois",
    country: "United States",
  },

  {
    code: "IN",
    label: "Indiana",
    country: "United States",
  },

  {
    code: "IA",
    label: "Iowa",
    country: "United States",
  },

  {
    code: "KS",
    label: "Kansas",
    country: "United States",
  },

  {
    code: "KY",
    label: "Kentucky",
    country: "United States",
  },

  {
    code: "LA",
    label: "Louisiana",
    country: "United States",
  },

  {
    code: "ME",
    label: "Maine",
    country: "United States",
  },

  {
    code: "MD",
    label: "Maryland",
    country: "United States",
  },

  {
    code: "MA",
    label: "Massachusetts",
    country: "United States",
  },

  {
    code: "MI",
    label: "Michigan",
    country: "United States",
  },

  {
    code: "MN",
    label: "Minnesota",
    country: "United States",
  },

  {
    code: "MS",
    label: "Mississippi",
    country: "United States",
  },

  {
    code: "MO",
    label: "Missouri",
    country: "United States",
  },

  {
    code: "MT",
    label: "Montana",
    country: "United States",
  },

  {
    code: "NE",
    label: "Nebraska",
    country: "United States",
  },

  {
    code: "NV",
    label: "Nevada",
    country: "United States",
  },

  {
    code: "NH",
    label: "New Hampshire",
    country: "United States",
  },

  {
    code: "NJ",
    label: "New Jersey",
    country: "United States",
  },

  {
    code: "NM",
    label: "New Mexico",
    country: "United States",
  },

  {
    code: "NY",
    label: "New York",
    country: "United States",
  },

  {
    code: "NC",
    label: "North Carolina",
    country: "United States",
  },

  {
    code: "ND",
    label: "North Dakota",
    country: "United States",
  },

  {
    code: "OH",
    label: "Ohio",
    country: "United States",
  },

  {
    code: "OK",
    label: "Oklahoma",
    country: "United States",
  },

  {
    code: "OR",
    label: "Oregon",
    country: "United States",
  },

  {
    code: "PA",
    label: "Pennsylvania",
    country: "United States",
  },

  {
    code: "RI",
    label: "Rhode Island",
    country: "United States",
  },

  {
    code: "SC",
    label: "South Carolina",
    country: "United States",
  },

  {
    code: "SD",
    label: "South Dakota",
    country: "United States",
  },

  {
    code: "TN",
    label: "Tennessee",
    country: "United States",
  },

  {
    code: "TX",
    label: "Texas",
    country: "United States",
  },

  {
    code: "UT",
    label: "Utah",
    country: "United States",
  },

  {
    code: "VT",
    label: "Vermont",
    country: "United States",
  },

  {
    code: "VA",
    label: "Virginia",
    country: "United States",
  },

  {
    code: "WA",
    label: "Washington",
    country: "United States",
  },

  {
    code: "WV",
    label: "West Virginia",
    country: "United States",
  },

  {
    code: "WI",
    label: "Wisconsin",
    country: "United States",
  },

  {
    code: "WY",
    label: "Wyoming",
    country: "United States",
  },
]

/* =========================================================
   GENERIC HELPERS
========================================================= */

function createId(
  prefix: string
) {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.floor(
    Math.random() * 100000
  )}`
}

function isoNow() {
  return new Date().toISOString()
}

function todayISO() {
  return new Date()
    .toISOString()
    .slice(0, 10)
}

function normalizeIdentifier(
  value?: string
) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

function normalizeText(
  value?: string
) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

function getCompanies(): Company[] {
  try {
    const parsed =
      JSON.parse(
        localStorage.getItem(
          "tes_companies"
        ) || "[]"
      )

    return Array.isArray(parsed)
      ? parsed
      : []
  } catch {
    return []
  }
}

function loadDeadlineRules():
  DeadlineRules {
  try {
    const raw =
      localStorage.getItem(
        SYSTEM_SETTINGS_KEY
      )

    if (!raw) {
      return DEFAULT_DEADLINE_RULES
    }

    const parsed =
      JSON.parse(raw)

    return {
      ...DEFAULT_DEADLINE_RULES,

      ...(parsed.deadlineRules ||
        parsed.expiryRules ||
        {}),
    }
  } catch {
    return DEFAULT_DEADLINE_RULES
  }
}

function readFileAsDataUrl(
  file: File
): Promise<string> {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const reader =
        new FileReader()

      reader.onload =
        () =>
          resolve(
            String(
              reader.result ||
                ""
            )
          )

      reader.onerror =
        reject

      reader.readAsDataURL(
        file
      )
    }
  )
}

/* =========================================================
   COMPANY APPLICABILITY
========================================================= */

function companyHasHazmat(
  company: Company
) {
  if (
    company.hazmat ===
    true
  ) {
    return true
  }

  if (
    Array.isArray(
      company.cargoTypes
    ) &&
    company.cargoTypes.some(
      (item) => {
        const text =
          normalizeText(
            item
          )

        return (
          text.includes(
            "haz"
          ) ||
          text.includes(
            "dangerous goods"
          )
        )
      }
    )
  ) {
    return true
  }

  if (
    company.cargoInformation
  ) {
    const text =
      JSON.stringify(
        company.cargoInformation
      ).toLowerCase()

    if (
      text.includes(
        '"hazmat":true'
      ) ||
      text.includes(
        '"hazardous":true'
      ) ||
      text.includes(
        '"dangerousgoods":true'
      ) ||
      text.includes(
        '"dangerous_goods":true'
      )
    ) {
      return true
    }
  }

  return false
}

type AuthorityProfile = {
  showCanadian:
    boolean

  showUS:
    boolean

  showUCR:
    boolean

  showPHMSA:
    boolean

  showCarrierProfile:
    boolean

  showSMSProfile:
    boolean

  hazmat:
    boolean
}

function deriveAuthorityProfile(
  company: Company
): AuthorityProfile {
  const country =
    normalizeText(
      company.regCorpCountry
    )

  const region =
    normalizeText(
      company.region
    )

  const crossBorder =
    region.includes(
      "cross"
    )

  const canadaOnly =
    !crossBorder &&
    (
      region.includes(
        "canada"
      ) ||
      (
        country.includes(
          "canada"
        ) &&
        !region.includes(
          "united states"
        ) &&
        !region.includes(
          "usa"
        )
      )
    )

  const usOnly =
    !crossBorder &&
    (
      region.includes(
        "united states"
      ) ||
      region.includes(
        "usa"
      ) ||
      region.includes(
        "us only"
      ) ||
      (
        country.includes(
          "united states"
        ) &&
        !region.includes(
          "canada"
        )
      )
    )

  let showCanadian =
    false

  let showUS =
    false

  if (crossBorder) {
    showCanadian =
      true

    showUS =
      true
  } else if (
    canadaOnly
  ) {
    showCanadian =
      true
  } else if (
    usOnly
  ) {
    showUS =
      true
  } else {
    /*
      Fallback only when Operating Region is incomplete.
    */

    showCanadian =
      country.includes(
        "canada"
      )

    showUS =
      country.includes(
        "united states"
      ) ||
      country ===
        "usa" ||
      country ===
        "us"
  }

  const hazmat =
    companyHasHazmat(
      company
    )

  return {
    showCanadian,

    showUS,

    showUCR:
      showUS,

    /*
      PHMSA disappears completely unless Hazmat +
      US operation applies.
    */
    showPHMSA:
      showUS &&
      hazmat,

    showCarrierProfile:
      showCanadian,

    showSMSProfile:
      showUS,

    hazmat,
  }
}

/* =========================================================
   THREE-YEAR HISTORY
========================================================= */

function historyCutoffDate() {
  const date =
    new Date()

  date.setFullYear(
    date.getFullYear() -
      THREE_YEAR_HISTORY
  )

  return date
}

function isDateInsideThreeYears(
  dateValue?: string
) {
  if (!dateValue) {
    return true
  }

  const date =
    new Date(
      dateValue
    )

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return true
  }

  return (
    date >=
    historyCutoffDate()
  )
}

function authorityReferenceDate(
  record:
    AuthorityRecord
) {
  return (
    record.expiryDate ||
    record.eventDate ||
    record.effectiveDate ||
    record.issueDate ||
    record.createdAt
  )
}

function safetyReferenceDate(
  record:
    SafetyRecord
) {
  return (
    record.reviewDate ||
    record.createdAt
  )
}

function auditReferenceDate(
  record:
    AuditRecord
) {
  return (
    record.completedDate ||
    record.noticeDate ||
    record.createdAt
  )
}

/* =========================================================
   DEADLINE ENGINE
========================================================= */

function getDaysRemaining(
  date?: string
) {
  if (!date) {
    return null
  }

  const target =
    new Date(
      `${date}T23:59:59`
    )

  const now =
    new Date()

  const today =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    )

  return Math.ceil(
    (
      target.getTime() -
      today.getTime()
    ) /
      86400000
  )
}

function getDeadlineStatus(
  date:
    | string
    | undefined,

  rules:
    DeadlineRules
): DeadlineStatus {
  if (!date) {
    return "No Deadline"
  }

  const days =
    getDaysRemaining(
      date
    )

  if (
    days === null
  ) {
    return "No Deadline"
  }

  if (
    days < 0
  ) {
    return "Expired"
  }

  if (
    days >=
      rules.criticalMinDays &&
    days <=
      rules.criticalMaxDays
  ) {
    return "Critical"
  }

  if (
    days >=
      rules.urgentMinDays &&
    days <
      rules.watchMinDays
  ) {
    return "Urgent"
  }

  if (
    days >=
      rules.watchMinDays &&
    days <
      rules.healthyMinDays
  ) {
    return "Watch"
  }

  return "Healthy"
}

function statusClasses(
  status:
    DeadlineStatus
) {
  switch (status) {
    case "Healthy":
      return {
        badge:
          "border-emerald-200 bg-emerald-50 text-emerald-800",

        left:
          "border-l-emerald-500",
      }

    case "Watch":
      return {
        badge:
          "border-amber-200 bg-amber-50 text-amber-800",

        left:
          "border-l-amber-400",
      }

    case "Urgent":
      return {
        badge:
          "border-red-200 bg-red-50 text-red-700",

        left:
          "border-l-red-400",
      }

    case "Critical":
      return {
        badge:
          "border-red-400 bg-red-100 text-red-900",

        left:
          "border-l-red-700",
      }

    case "Expired":
      return {
        badge:
          "border-red-900 bg-red-950 text-white",

        left:
          "border-l-red-950",
      }

    default:
      return {
        badge:
          "border-slate-200 bg-slate-50 text-slate-600",

        left:
          "border-l-slate-300",
      }
  }
}

function DeadlineBadge({
  status,
}: {
  status:
    DeadlineStatus
}) {
  const style =
    statusClasses(
      status
    )

  return (
    <Badge
      variant="outline"
      className={`gap-1 whitespace-nowrap ${style.badge}`}
    >
      {status ===
        "Healthy" && (
        <CheckCircle2 className="size-3" />
      )}

      {status ===
        "Watch" && (
        <CalendarClock className="size-3" />
      )}

      {(status ===
        "Urgent" ||
        status ===
          "Critical") && (
        <AlertTriangle className="size-3" />
      )}

      {status ===
        "Expired" && (
        <XCircle className="size-3" />
      )}

      {status}
    </Badge>
  )
}

/* =========================================================
   GLOBAL DUPLICATION
========================================================= */

function findGlobalAuthorityConflict({
  currentCompanyId,
  authorityType,
  number,
  editingId,
}: {
  currentCompanyId:
    string

  authorityType:
    AuthorityType

  number:
    string

  editingId?:
    string
}) {
  const normalizedNumber =
    normalizeIdentifier(
      number
    )

  if (
    !normalizedNumber
  ) {
    return null
  }

  for (
    const company of
    getCompanies()
  ) {
    try {
      const raw =
        localStorage.getItem(
          `tes_company_authorities_${company.id}`
        )

      if (!raw) {
        continue
      }

      const parsed =
        JSON.parse(raw)

      const records:
        AuthorityRecord[] =
        Array.isArray(
          parsed?.authorities
        )
          ? parsed.authorities
          : []

      const match =
        records.find(
          (record) =>
            record.id !==
              editingId &&
            record.authorityType ===
              authorityType &&
            normalizeIdentifier(
              record.number
            ) ===
              normalizedNumber
        )

      if (match) {
        return {
          companyId:
            company.id,

          companyName:
            company.name,

          sameCompany:
            company.id ===
            currentCompanyId,

          record:
            match,
        }
      }
    } catch {
      // Ignore malformed development data.
    }
  }

  return null
}

/* =========================================================
   STANDARD OCR ICON
========================================================= */

function ScanDocumentIcon({
  size = 16,
}: {
  size?: number
}) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
      }}
    >
      <span className="absolute inset-0">
        <span className="absolute left-0 top-0 h-[35%] w-[35%] rounded-tl-[2px] border-l-[1.5px] border-t-[1.5px] border-current" />

        <span className="absolute right-0 top-0 h-[35%] w-[35%] rounded-tr-[2px] border-r-[1.5px] border-t-[1.5px] border-current" />

        <span className="absolute bottom-0 left-0 h-[35%] w-[35%] rounded-bl-[2px] border-b-[1.5px] border-l-[1.5px] border-current" />

        <span className="absolute bottom-0 right-0 h-[35%] w-[35%] rounded-br-[2px] border-b-[1.5px] border-r-[1.5px] border-current" />
      </span>

      <FileText
        style={{
          width:
            size * 0.58,

          height:
            size * 0.58,

          strokeWidth:
            1.8,
        }}
      />
    </span>
  )
}

/* =========================================================
   JURISDICTION / COUNTRY
========================================================= */

function JurisdictionCountryFields({
  jurisdictionCode,
  country,
  allowedCountries,
  onChange,
}: {
  jurisdictionCode:
    string

  country:
    string

  allowedCountries?: (
    | "Canada"
    | "United States"
  )[]

  onChange: (
    value: {
      jurisdictionCode: string
      jurisdictionLabel: string
      country: string
    }
  ) => void
}) {
  const options =
    allowedCountries?.length
      ? JURISDICTIONS.filter(
          (item) =>
            allowedCountries.includes(
              item.country
            )
        )
      : JURISDICTIONS

  return (
    <>
      {/* LOCKED STANDARD:
          Jurisdiction first.
      */}

      <div className="space-y-2">
        <Label>
          Jurisdiction *
        </Label>

        <Select
          value={
            jurisdictionCode ||
            undefined
          }
          onValueChange={(
            code
          ) => {
            const selected =
              JURISDICTIONS.find(
                (item) =>
                  item.code ===
                  code
              )

            if (!selected) {
              return
            }

            onChange({
              jurisdictionCode:
                selected.code,

              jurisdictionLabel:
                selected.label,

              country:
                selected.country,
            })
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select jurisdiction" />
          </SelectTrigger>

          <SelectContent className="z-[200] max-h-[340px]">
            {options.map(
              (item) => (
                <SelectItem
                  key={
                    item.code
                  }
                  value={
                    item.code
                  }
                >
                  {
                    item.label
                  }
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Country comes AFTER jurisdiction and is automatic. */}

      <div className="space-y-2">
        <Label>
          Country
        </Label>

        <Input
          value={
            country
          }
          readOnly
          className="bg-muted/30"
        />
      </div>
    </>
  )
}

/* =========================================================
   COPY
========================================================= */

function CopyField({
  label,
  value,
}: {
  label:
    string

  value?:
    string
}) {
  const [
    copied,
    setCopied,
  ] =
    useState(false)

  const copy =
    async () => {
      if (!value) {
        return
      }

      try {
        await navigator.clipboard.writeText(
          value
        )

        setCopied(
          true
        )

        window.setTimeout(
          () =>
            setCopied(
              false
            ),
          900
        )
      } catch {
        //
      }
    }

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>

      <div className="mt-1 flex items-center gap-1">
        <span className="min-w-0 flex-1 select-text break-words text-xs font-medium">
          {value ||
            "Not recorded"}
        </span>

        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={
              copy
            }
          >
            {copied ? (
              <CheckCircle2 className="size-3.5 text-emerald-600" />
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
   AUTHORITY CONFIG
========================================================= */

function authorityDisplayName(
  type:
    AuthorityType
) {
  switch (type) {
    case "PROVINCIAL_CARRIER_IDENTIFIER":
      return "Provincial Carrier Identifier (MVID / RIN)"

    case "CANADIAN_SAFETY_AUTHORITY":
      return "NSC / Safety Fitness Certificate / CVOR"

    case "USDOT":
      return "USDOT Number"

    case "MC":
      return "MC Operating Authority"

    case "MCS150":
      return "MCS-150 Biennial Update"

    case "UCR":
      return "Unified Carrier Registration (UCR)"

    case "PHMSA":
      return "PHMSA Registration"

    default:
      return "Other Authority / Registration"
  }
}

function defaultIssuingAuthority(
  type:
    AuthorityType
) {
  switch (type) {
    case "USDOT":
    case "MC":
    case "MCS150":
      return "FMCSA"

    case "PHMSA":
      return "PHMSA"

    case "UCR":
      return "UCR"

    default:
      return ""
  }
}

function authorityOptions(
  category:
    AuthorityCategory,

  profile:
    AuthorityProfile
): {
  value:
    AuthorityType

  label:
    string
}[] {
  if (
    category ===
    "canadian"
  ) {
    return [
      {
        value:
          "PROVINCIAL_CARRIER_IDENTIFIER",

        label:
          "Provincial Carrier Identifier (MVID / RIN)",
      },

      {
        value:
          "CANADIAN_SAFETY_AUTHORITY",

        label:
          "NSC / Safety Fitness Certificate / CVOR",
      },
    ]
  }

  if (
    category ===
    "us_federal"
  ) {
    return [
      {
        value:
          "USDOT",

        label:
          "USDOT Number",
      },

      {
        value:
          "MC",

        label:
          "MC Operating Authority",
      },

      {
        value:
          "MCS150",

        label:
          "MCS-150 Biennial Update",
      },
    ]
  }

  const options: {
    value:
      AuthorityType

    label:
      string
  }[] = []

  if (
    profile.showUCR
  ) {
    options.push({
      value:
        "UCR",

      label:
        "Unified Carrier Registration (UCR)",
    })
  }

  if (
    profile.showPHMSA
  ) {
    options.push({
      value:
        "PHMSA",

      label:
        "PHMSA Registration",
    })
  }

  return options
}

/* =========================================================
   DEFAULT JURISDICTIONS / DRAFTS
========================================================= */

function defaultJurisdictionFor(
  company:
    Company,

  category:
    AuthorityCategory
) {
  if (
    category ===
      "us_federal" ||
    category ===
      "operating_registration"
  ) {
    return JURISDICTIONS.find(
      (item) =>
        item.code ===
        "US-FED"
    )!
  }

  const state =
    normalizeText(
      company.regCorpState
    )

  return (
    JURISDICTIONS.find(
      (item) =>
        item.country ===
          "Canada" &&
        (
          normalizeText(
            item.code
          ) ===
            state ||
          normalizeText(
            item.label
          ) ===
            state
        )
    ) ||
    JURISDICTIONS.find(
      (item) =>
        item.code ===
        "CA-FED"
    )!
  )
}

function emptyAuthorityDraft(
  company:
    Company,

  category:
    AuthorityCategory,

  type?:
    AuthorityType
): AuthorityDraft {
  const jurisdiction =
    defaultJurisdictionFor(
      company,
      category
    )

  const authorityType =
    type ||
    (
      category ===
      "canadian"
        ? "PROVINCIAL_CARRIER_IDENTIFIER"
        : category ===
            "us_federal"
          ? "USDOT"
          : "UCR"
    )

  return {
    category,

    authorityType,

    name:
      authorityDisplayName(
        authorityType
      ),

    number:
      "",

    issuingAuthority:
      defaultIssuingAuthority(
        authorityType
      ),

    jurisdictionCode:
      jurisdiction.code,

    jurisdictionLabel:
      jurisdiction.label,

    country:
      jurisdiction.country,

    status:
      "Active",

    issueDate:
      "",

    effectiveDate:
      "",

    expiryDate:
      "",

    eventDate:
      "",

    nextActionDate:
      "",

    notes:
      "",
  }
}

function emptySafetyDraft(
  company:
    Company,

  system:
    SafetySystem
): SafetyDraft {
  const jurisdiction =
    system ===
    "SMS_PROFILE"
      ? JURISDICTIONS.find(
          (item) =>
            item.code ===
            "US-FED"
        )!
      : defaultJurisdictionFor(
          company,
          "canadian"
        )

  return {
    system,

    jurisdictionCode:
      jurisdiction.code,

    jurisdictionLabel:
      jurisdiction.label,

    country:
      jurisdiction.country,

    reviewDate:
      todayISO(),

    summary:
      "",

    notes:
      "",
  }
}

function emptyAuditDraft(
  company:
    Company
): AuditDraft {
  const canada =
    normalizeText(
      company.regCorpCountry
    ).includes(
      "canada"
    )

  const country =
    canada
      ? "Canada"
      : "United States"

  const jurisdiction =
    JURISDICTIONS.find(
      (item) =>
        item.country ===
          country &&
        normalizeText(
          item.label
        ) ===
          normalizeText(
            company.regCorpState
          )
    ) ||
    JURISDICTIONS.find(
      (item) =>
        item.code ===
        (
          country ===
          "Canada"
            ? "CA-FED"
            : "US-FED"
        )
    )!

  return {
    auditType:
      "",

    regulator:
      "",

    jurisdictionCode:
      jurisdiction.code,

    jurisdictionLabel:
      jurisdiction.label,

    country:
      jurisdiction.country,

    referenceNumber:
      "",

    noticeDate:
      "",

    dueDate:
      "",

    completedDate:
      "",

    status:
      "Open",

    outcome:
      "",

    score:
      "",

    followUpRequired:
      false,

    followUpDueDate:
      "",

    notes:
      "",
  }
}

/* =========================================================
   DOCUMENT SOURCE
========================================================= */

function DocumentSourcePicker({
  onCamera,
  onDevice,
  onClose,
}: {
  onCamera: () => void
  onDevice: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ScanDocumentIcon
                  size={18}
                />

                Scan Document
              </CardTitle>

              <CardDescription className="mt-1">
                Select where the source document is coming from.
              </CardDescription>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={
                onClose
              }
            >
              <X className="size-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={
              onCamera
            }
            className="rounded-xl border p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.035]"
          >
            <Camera className="size-6 text-primary" />

            <p className="mt-4 text-sm font-semibold">
              Take Photo
            </p>

            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Capture the complete source document.
            </p>
          </button>

          <button
            type="button"
            onClick={
              onDevice
            }
            className="rounded-xl border p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.035]"
          >
            <Upload className="size-6 text-primary" />

            <p className="mt-4 text-sm font-semibold">
              Upload from Device
            </p>

            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Select an existing PDF or image.
            </p>
          </button>
        </CardContent>
      </Card>
    </div>
  )
}

/* =========================================================
   CAMERA
========================================================= */

function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture:
    (
      file: File
    ) => void

  onClose:
    () => void
}) {
  const videoRef =
    useRef<HTMLVideoElement | null>(
      null
    )

  const canvasRef =
    useRef<HTMLCanvasElement | null>(
      null
    )

  const streamRef =
    useRef<MediaStream | null>(
      null
    )

  const [
    ready,
    setReady,
  ] =
    useState(false)

  const [
    error,
    setError,
  ] =
    useState("")

  useEffect(() => {
    const start =
      async () => {
        try {
          const stream =
            await navigator.mediaDevices.getUserMedia(
              {
                video: {
                  facingMode: {
                    ideal:
                      "environment",
                  },

                  width: {
                    ideal:
                      1920,
                  },

                  height: {
                    ideal:
                      1080,
                  },
                },

                audio:
                  false,
              }
            )

          streamRef.current =
            stream

          if (
            videoRef.current
          ) {
            videoRef.current.srcObject =
              stream

            await videoRef.current.play()

            setReady(
              true
            )
          }
        } catch {
          setError(
            "TES could not access the camera. Check browser camera permissions."
          )
        }
      }

    start()

    return () => {
      streamRef.current
        ?.getTracks()
        .forEach(
          (track) =>
            track.stop()
        )
    }
  }, [])

  const capture =
    () => {
      const video =
        videoRef.current

      const canvas =
        canvasRef.current

      if (
        !video ||
        !canvas
      ) {
        return
      }

      canvas.width =
        video.videoWidth

      canvas.height =
        video.videoHeight

      const context =
        canvas.getContext(
          "2d"
        )

      if (!context) {
        return
      }

      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      )

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            return
          }

          streamRef.current
            ?.getTracks()
            .forEach(
              (track) =>
                track.stop()
            )

          onCapture(
            new File(
              [blob],

              `authority-capture-${Date.now()}.jpg`,

              {
                type:
                  "image/jpeg",
              }
            )
          )
        },

        "image/jpeg",

        0.95
      )
    }

  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-black">
      <div className="flex min-h-16 items-center justify-between border-b border-white/10 px-5 text-white">
        <div>
          <p className="text-sm font-semibold">
            Capture Document
          </p>

          <p className="text-[10px] text-white/60">
            Keep the complete document inside the frame.
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/10 hover:text-white"
          onClick={
            onClose
          }
        >
          <X className="size-5" />
        </Button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {error ? (
          <div className="max-w-md rounded-xl border border-red-900 bg-red-950/50 p-6 text-center text-white">
            <AlertTriangle className="mx-auto size-8 text-red-400" />

            <p className="mt-3 text-sm font-semibold">
              Camera unavailable
            </p>

            <p className="mt-2 text-xs text-white/70">
              {error}
            </p>
          </div>
        ) : (
          <>
            <video
              ref={
                videoRef
              }
              playsInline
              muted
              className="max-h-full max-w-full object-contain"
            />

            <div className="pointer-events-none absolute inset-[8%] rounded-xl border-2 border-dashed border-white/60" />
          </>
        )}

        <canvas
          ref={
            canvasRef
          }
          className="hidden"
        />
      </div>

      <div className="flex min-h-24 items-center justify-center border-t border-white/10">
        <Button
          size="lg"
          className="rounded-full px-8"
          disabled={
            !ready
          }
          onClick={
            capture
          }
        >
          <Camera className="mr-2 size-5" />

          Capture Photo
        </Button>
      </div>
    </div>
  )
}

/* =========================================================
   DOCUMENT VIEWER

   Images:
   - fit
   - zoom
   - pan
   - rotate
   - fullscreen

   PDFs:
   - use ALL available viewer space
   - browser PDF controls remain usable
   - fullscreen works on the complete TES viewer
========================================================= */

function DocumentViewer({
  fileName,
  mimeType,
  dataUrl,
  onClose,
  onReplace,
}: {
  fileName:
    string

  mimeType:
    string

  dataUrl:
    string

  onClose?:
    () => void

  onReplace?:
    () => void
}) {
  const rootRef =
    useRef<HTMLDivElement | null>(
      null
    )

  const dragRef =
    useRef({
      active:
        false,

      x: 0,

      y: 0,
    })

  const [
    zoom,
    setZoom,
  ] =
    useState(1)

  const [
    rotation,
    setRotation,
  ] =
    useState(0)

  const [
    pan,
    setPan,
  ] =
    useState({
      x: 0,

      y: 0,
    })

  const isPdf =
    mimeType ===
    "application/pdf"

  const reset =
    () => {
      setZoom(
        1
      )

      setRotation(
        0
      )

      setPan({
        x: 0,

        y: 0,
      })
    }

  const fullscreen =
    async () => {
      if (
        !rootRef.current
      ) {
        return
      }

      try {
        if (
          !document.fullscreenElement
        ) {
          await rootRef.current.requestFullscreen()
        } else {
          await document.exitFullscreen()
        }
      } catch {
        //
      }
    }

  return (
    <div
      ref={
        rootRef
      }
      className="flex h-full min-h-0 flex-col bg-background fullscreen:bg-background"
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold">
            Original Document
          </p>

          <p className="max-w-[450px] truncate text-[10px] text-muted-foreground">
            {fileName}
          </p>
        </div>

        <div className="flex items-center gap-1">
          {!isPdf && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={
                  reset
                }
              >
                Fit
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() =>
                  setZoom(
                    (current) =>
                      Math.max(
                        0.5,
                        current -
                          0.25
                      )
                  )
                }
              >
                <ZoomOut className="size-4" />
              </Button>

              <span className="w-12 text-center text-[10px]">
                {Math.round(
                  zoom *
                    100
                )}
                %
              </span>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() =>
                  setZoom(
                    (current) =>
                      Math.min(
                        5,
                        current +
                          0.25
                      )
                  )
                }
              >
                <ZoomIn className="size-4" />
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() =>
                  setRotation(
                    (current) =>
                      (
                        current +
                        90
                      ) %
                      360
                  )
                }
              >
                <RotateCcw className="size-4" />
              </Button>
            </>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={
              fullscreen
            }
          >
            <Maximize2 className="size-4" />
          </Button>

          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={
                onClose
              }
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-muted/15">
        {isPdf ? (
          /*
            IMPORTANT:

            Do not place the PDF inside another tiny fixed-size
            iframe. It consumes the full document workspace.

            The native PDF viewer provides PDF scrolling/zoom,
            while TES controls fullscreen at the workspace level.
          */

          <embed
            src={
              dataUrl
            }
            type="application/pdf"
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <div
            className="absolute inset-0 flex cursor-grab items-center justify-center overflow-hidden p-5 active:cursor-grabbing"
            style={{
              touchAction:
                "none",
            }}
            onPointerDown={(
              event
            ) => {
              dragRef.current = {
                active:
                  true,

                x:
                  event.clientX,

                y:
                  event.clientY,
              }

              event.currentTarget.setPointerCapture(
                event.pointerId
              )
            }}
            onPointerMove={(
              event
            ) => {
              if (
                !dragRef.current
                  .active
              ) {
                return
              }

              const dx =
                event.clientX -
                dragRef.current.x

              const dy =
                event.clientY -
                dragRef.current.y

              dragRef.current.x =
                event.clientX

              dragRef.current.y =
                event.clientY

              setPan(
                (current) => ({
                  x:
                    current.x +
                    dx,

                  y:
                    current.y +
                    dy,
                })
              )
            }}
            onPointerUp={() => {
              dragRef.current.active =
                false
            }}
            onPointerCancel={() => {
              dragRef.current.active =
                false
            }}
          >
            <img
              src={
                dataUrl
              }
              alt={
                fileName
              }
              draggable={
                false
              }
              className="max-h-full max-w-full select-none object-contain shadow-sm"
              style={{
                transform: `
                  translate(${pan.x}px, ${pan.y}px)
                  scale(${zoom})
                  rotate(${rotation}deg)
                `,

                transformOrigin:
                  "center center",
              }}
            />
          </div>
        )}
      </div>

      <div className="flex min-h-12 items-center justify-between gap-3 border-t px-4">
        <p className="min-w-0 truncate text-[10px] text-muted-foreground">
          {fileName}
        </p>

        {onReplace && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={
              onReplace
            }
          >
            <RefreshCcw className="mr-1.5 size-3.5" />

            Replace Document
          </Button>
        )}
      </div>
    </div>
  )
}

function DocumentPreviewModal({
  evidence,
  onClose,
}: {
  evidence:
    AuthorityEvidence

  onClose:
    () => void
}) {
  return (
    <div className="fixed inset-0 z-[170] bg-background">
      <DocumentViewer
        fileName={
          evidence.fileName
        }
        mimeType={
          evidence.mimeType
        }
        dataUrl={
          evidence.dataUrl
        }
        onClose={
          onClose
        }
      />
    </div>
  )
}

/* =========================================================
   AUTHORITY FORM
========================================================= */

function AuthorityForm({
  draft,
  profile,
  onChange,
}: {
  draft:
    AuthorityDraft

  profile:
    AuthorityProfile

  onChange:
    (
      draft:
        AuthorityDraft
    ) => void
}) {
  const options =
    authorityOptions(
      draft.category,
      profile
    )

  const periodic =
    draft.authorityType ===
    "MCS150"

  const allowedCountries:
    (
      | "Canada"
      | "United States"
    )[] =
    draft.category ===
    "canadian"
      ? [
          "Canada",
        ]
      : [
          "United States",
        ]

  const patch =
    (
      value:
        Partial<AuthorityDraft>
    ) => {
      onChange({
        ...draft,

        ...value,
      })
    }

  return (
    <Card className="overflow-visible shadow-none">
      <CardHeader className="border-b bg-muted/15 py-4">
        <CardTitle className="text-sm">
          Authority / Registration Information
        </CardTitle>

        <CardDescription className="text-xs">
          OCR and manual entry use the same authoritative fields.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label>
            Record Type *
          </Label>

          <Select
            value={
              draft.authorityType
            }
            onValueChange={(
              value
            ) => {
              const type =
                value as
                  AuthorityType

              patch({
                authorityType:
                  type,

                name:
                  authorityDisplayName(
                    type
                  ),

                issuingAuthority:
                  defaultIssuingAuthority(
                    type
                  ),
              })
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="z-[200]">
              {options.map(
                (
                  option
                ) => (
                  <SelectItem
                    key={
                      option.value
                    }
                    value={
                      option.value
                    }
                  >
                    {
                      option.label
                    }
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>
            Display Name *
          </Label>

          <Input
            value={
              draft.name
            }
            onChange={(
              event
            ) =>
              patch({
                name:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            {periodic
              ? "Reference / Filing Number"
              : "Authority / Registration Number *"}
          </Label>

          <Input
            value={
              draft.number
            }
            onChange={(
              event
            ) =>
              patch({
                number:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Issuing Authority
          </Label>

          <Input
            value={
              draft.issuingAuthority
            }
            onChange={(
              event
            ) =>
              patch({
                issuingAuthority:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <JurisdictionCountryFields
          jurisdictionCode={
            draft.jurisdictionCode
          }
          country={
            draft.country
          }
          allowedCountries={
            allowedCountries
          }
          onChange={(
            value
          ) =>
            patch(
              value
            )
          }
        />

        <div className="space-y-2">
          <Label>
            Record Status
          </Label>

          <Select
            value={
              draft.status
            }
            onValueChange={(
              value
            ) =>
              patch({
                status:
                  value as
                    AuthorityRecord["status"],
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="z-[200]">
              <SelectItem value="Active">
                Active
              </SelectItem>

              <SelectItem value="Pending">
                Pending
              </SelectItem>

              <SelectItem value="Inactive">
                Inactive
              </SelectItem>

              <SelectItem value="Suspended">
                Suspended
              </SelectItem>

              <SelectItem value="Expired">
                Expired
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {periodic ? (
          <>
            <div className="space-y-2">
              <Label>
                Filed / Update Date
              </Label>

              <Input
                type="date"
                value={
                  draft.eventDate
                }
                onChange={(
                  event
                ) =>
                  patch({
                    eventDate:
                      event.target
                        .value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>
                Next Action Date
              </Label>

              <Input
                type="date"
                value={
                  draft.nextActionDate
                }
                onChange={(
                  event
                ) =>
                  patch({
                    nextActionDate:
                      event.target
                        .value,
                  })
                }
              />

              <p className="text-[10px] text-muted-foreground">
                This can later be populated automatically by the central regulatory rule engine.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label>
                Issue Date
              </Label>

              <Input
                type="date"
                value={
                  draft.issueDate
                }
                onChange={(
                  event
                ) =>
                  patch({
                    issueDate:
                      event.target
                        .value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>
                Effective Date
              </Label>

              <Input
                type="date"
                value={
                  draft.effectiveDate
                }
                onChange={(
                  event
                ) =>
                  patch({
                    effectiveDate:
                      event.target
                        .value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>
                Expiry Date
              </Label>

              <Input
                type="date"
                value={
                  draft.expiryDate
                }
                onChange={(
                  event
                ) =>
                  patch({
                    expiryDate:
                      event.target
                        .value,
                  })
                }
              />
            </div>
          </>
        )}

        <div className="space-y-2 md:col-span-2">
          <Label>
            Notes
          </Label>

          <Input
            value={
              draft.notes
            }
            onChange={(
              event
            ) =>
              patch({
                notes:
                  event.target
                    .value,
              })
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   SAFETY FORM
========================================================= */

function SafetyForm({
  draft,
  onChange,
}: {
  draft:
    SafetyDraft

  onChange:
    (
      draft:
        SafetyDraft
    ) => void
}) {
  const patch =
    (
      value:
        Partial<SafetyDraft>
    ) => {
      onChange({
        ...draft,

        ...value,
      })
    }

  return (
    <Card className="overflow-visible shadow-none">
      <CardHeader className="border-b bg-muted/15 py-4">
        <CardTitle className="text-sm">
          {draft.system ===
          "CARRIER_PROFILE_CVOR"
            ? "Carrier Profile / CVOR"
            : "SMS Profile"}
        </CardTitle>

        <CardDescription className="text-xs">
          High-level structure only. Detailed Safety architecture will be built separately.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
        <JurisdictionCountryFields
          jurisdictionCode={
            draft.jurisdictionCode
          }
          country={
            draft.country
          }
          allowedCountries={
            draft.system ===
            "CARRIER_PROFILE_CVOR"
              ? [
                  "Canada",
                ]
              : [
                  "United States",
                ]
          }
          onChange={(
            value
          ) =>
            patch(
              value
            )
          }
        />

        <div className="space-y-2">
          <Label>
            Review Date
          </Label>

          <Input
            type="date"
            value={
              draft.reviewDate
            }
            onChange={(
              event
            ) =>
              patch({
                reviewDate:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Status Summary
          </Label>

          <Input
            value={
              draft.summary
            }
            onChange={(
              event
            ) =>
              patch({
                summary:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label>
            Notes
          </Label>

          <Input
            value={
              draft.notes
            }
            onChange={(
              event
            ) =>
              patch({
                notes:
                  event.target
                    .value,
              })
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   AUDIT FORM
========================================================= */

function AuditForm({
  draft,
  onChange,
}: {
  draft:
    AuditDraft

  onChange:
    (
      draft:
        AuditDraft
    ) => void
}) {
  const patch =
    (
      value:
        Partial<AuditDraft>
    ) => {
      onChange({
        ...draft,

        ...value,
      })
    }

  return (
    <Card className="overflow-visible shadow-none">
      <CardHeader className="border-b bg-muted/15 py-4">
        <CardTitle className="text-sm">
          Audit / Intervention
        </CardTitle>
      </CardHeader>

      <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label>
            Audit / Intervention Type *
          </Label>

          <Input
            value={
              draft.auditType
            }
            onChange={(
              event
            ) =>
              patch({
                auditType:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Regulator / Authority *
          </Label>

          <Input
            value={
              draft.regulator
            }
            onChange={(
              event
            ) =>
              patch({
                regulator:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <JurisdictionCountryFields
          jurisdictionCode={
            draft.jurisdictionCode
          }
          country={
            draft.country
          }
          onChange={(
            value
          ) =>
            patch(
              value
            )
          }
        />

        <div className="space-y-2">
          <Label>
            Notice / Reference Number
          </Label>

          <Input
            value={
              draft.referenceNumber
            }
            onChange={(
              event
            ) =>
              patch({
                referenceNumber:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Notice Date
          </Label>

          <Input
            type="date"
            value={
              draft.noticeDate
            }
            onChange={(
              event
            ) =>
              patch({
                noticeDate:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Due Date
          </Label>

          <Input
            type="date"
            value={
              draft.dueDate
            }
            onChange={(
              event
            ) =>
              patch({
                dueDate:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Completed Date
          </Label>

          <Input
            type="date"
            value={
              draft.completedDate
            }
            onChange={(
              event
            ) =>
              patch({
                completedDate:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Status
          </Label>

          <Select
            value={
              draft.status
            }
            onValueChange={(
              value
            ) =>
              patch({
                status:
                  value as
                    AuditRecord["status"],
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="z-[200]">
              <SelectItem value="Open">
                Open
              </SelectItem>

              <SelectItem value="Scheduled">
                Scheduled
              </SelectItem>

              <SelectItem value="In Progress">
                In Progress
              </SelectItem>

              <SelectItem value="Completed">
                Completed
              </SelectItem>

              <SelectItem value="Closed">
                Closed
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>
            Outcome
          </Label>

          <Input
            value={
              draft.outcome
            }
            onChange={(
              event
            ) =>
              patch({
                outcome:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Score / Rating
          </Label>

          <Input
            value={
              draft.score
            }
            onChange={(
              event
            ) =>
              patch({
                score:
                  event.target
                    .value,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Follow-up Required
          </Label>

          <Select
            value={
              draft.followUpRequired
                ? "yes"
                : "no"
            }
            onValueChange={(
              value
            ) =>
              patch({
                followUpRequired:
                  value ===
                  "yes",
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="z-[200]">
              <SelectItem value="yes">
                Yes
              </SelectItem>

              <SelectItem value="no">
                No
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {draft.followUpRequired && (
          <div className="space-y-2">
            <Label>
              Follow-up Due Date
            </Label>

            <Input
              type="date"
              value={
                draft.followUpDueDate
              }
              onChange={(
                event
              ) =>
                patch({
                  followUpDueDate:
                    event.target
                      .value,
                })
              }
            />
          </div>
        )}

        <div className="space-y-2 md:col-span-2">
          <Label>
            Notes
          </Label>

          <Input
            value={
              draft.notes
            }
            onChange={(
              event
            ) =>
              patch({
                notes:
                  event.target
                    .value,
              })
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   MANUAL MODAL
========================================================= */

type ManualState =
  | {
      mode:
        "authority"

      draft:
        AuthorityDraft
    }
  | {
      mode:
        "safety"

      draft:
        SafetyDraft
    }
  | {
      mode:
        "audit"

      draft:
        AuditDraft
    }

function ManualModal({
  state,
  profile,
  onChange,
  onCancel,
  onSave,
}: {
  state:
    ManualState

  profile:
    AuthorityProfile

  onChange:
    (
      state:
        ManualState
    ) => void

  onCancel:
    () => void

  onSave:
    () => void
}) {
  const ready =
    state.mode ===
    "authority"
      ? Boolean(
          state.draft.name.trim() &&
          (
            state.draft.authorityType ===
              "MCS150" ||
            state.draft.number.trim()
          )
        )
      : state.mode ===
          "safety"
        ? Boolean(
            state.draft.reviewDate
          )
        : Boolean(
            state.draft.auditType.trim() &&
            state.draft.regulator.trim()
          )

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-black/45 p-4 backdrop-blur-sm">
      <div className="mx-auto my-6 max-w-5xl">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">
                  {state.mode ===
                  "authority"
                    ? "Add Authority / Registration"
                    : state.mode ===
                        "safety"
                      ? "Add Safety Snapshot"
                      : "Add Audit / Intervention"}
                </CardTitle>

                <CardDescription className="mt-1">
                  Manual entry uses the same record model as OCR.
                </CardDescription>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={
                  onCancel
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 pt-5">
            {state.mode ===
              "authority" && (
              <AuthorityForm
                draft={
                  state.draft
                }
                profile={
                  profile
                }
                onChange={(
                  draft
                ) =>
                  onChange({
                    mode:
                      "authority",

                    draft,
                  })
                }
              />
            )}

            {state.mode ===
              "safety" && (
              <SafetyForm
                draft={
                  state.draft
                }
                onChange={(
                  draft
                ) =>
                  onChange({
                    mode:
                      "safety",

                    draft,
                  })
                }
              />
            )}

            {state.mode ===
              "audit" && (
              <AuditForm
                draft={
                  state.draft
                }
                onChange={(
                  draft
                ) =>
                  onChange({
                    mode:
                      "audit",

                    draft,
                  })
                }
              />
            )}

            <div className="flex justify-end gap-2 border-t pt-5">
              <Button
                variant="outline"
                onClick={
                  onCancel
                }
              >
                Cancel
              </Button>

              <Button
                disabled={
                  !ready
                }
                onClick={
                  onSave
                }
              >
                <Save className="mr-2 size-4" />

                Save Record
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/* =========================================================
   OCR REQUEST
========================================================= */

async function requestOCR(
  session:
    OCRSession
): Promise<
  Partial<OCRSession>
> {
  try {
    const body =
      new FormData()

    body.append(
      "file",
      session.file
    )

    body.append(
      "mode",
      session.mode
    )

    if (
      session.authorityDraft
    ) {
      body.append(
        "category",
        session.authorityDraft.category
      )

      body.append(
        "authorityType",
        session.authorityDraft.authorityType
      )
    }

    if (
      session.safetyDraft
    ) {
      body.append(
        "safetySystem",
        session.safetyDraft.system
      )
    }

    const response =
      await fetch(
        "/api/document-intelligence/authorities",

        {
          method:
            "POST",

          body,
        }
      )

    if (
      response.ok
    ) {
      return await response.json()
    }
  } catch {
    //
  }

  /*
    Never fabricate authority identifiers/dates.
    The workflow still remains testable if OCR backend
    isn't connected yet.
  */

  return {
    extractionComplete:
      true,
  }
}

/* =========================================================
   OCR WORKSPACE
========================================================= */

function OCRWorkspace({
  session,
  profile,
  setSession,
  onCancel,
  onReplace,
  onSave,
}: {
  session:
    OCRSession

  profile:
    AuthorityProfile

  setSession:
    React.Dispatch<
      React.SetStateAction<OCRSession | null>
    >

  onCancel:
    () => void

  onReplace:
    () => void

  onSave:
    () => void
}) {
  const run =
    async () => {
      setSession(
        (current) =>
          current
            ? {
                ...current,

                processing:
                  true,
              }
            : current
      )

      const result =
        await requestOCR(
          session
        )

      setSession(
        (current) =>
          current
            ? {
                ...current,

                ...result,

                processing:
                  false,

                extractionComplete:
                  true,
              }
            : current
      )
    }

  const ready =
    session.mode ===
    "authority"
      ? Boolean(
          session.authorityDraft?.name.trim() &&
          (
            session.authorityDraft?.authorityType ===
              "MCS150" ||
            session.authorityDraft?.number.trim()
          )
        )
      : session.mode ===
          "safety"
        ? Boolean(
            session.safetyDraft?.reviewDate
          )
        : Boolean(
            session.auditDraft?.auditType.trim() &&
            session.auditDraft?.regulator.trim()
          )

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-background">
      <div className="flex min-h-16 items-center justify-between gap-4 border-b px-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ScanDocumentIcon
              size={18}
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">
                Document Intelligence Review
              </p>

              <Badge
                variant="outline"
                className="gap-1 text-[9px]"
              >
                <Sparkles className="size-3" />

                AI Assisted
              </Badge>
            </div>

            <p className="text-[10px] text-muted-foreground">
              {
                session.file.name
              }
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={
            onCancel
          }
        >
          <X className="size-5" />
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(520px,1fr)_minmax(620px,1fr)]">
        <div className="min-h-0 border-r">
          <DocumentViewer
            fileName={
              session.file.name
            }
            mimeType={
              session.file.type
            }
            dataUrl={
              session.dataUrl
            }
            onReplace={
              onReplace
            }
          />
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="border-b p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">
                  Extracted Information
                </h2>

                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  OCR is the primary data-entry layer. Review or correct only what is necessary before saving.
                </p>
              </div>

              {session.confidence !==
                undefined && (
                <div className="text-right">
                  <p className="text-xl font-bold text-emerald-600">
                    {
                      session.confidence
                    }
                    %
                  </p>

                  <p className="text-[10px] text-muted-foreground">
                    OCR confidence
                  </p>
                </div>
              )}
            </div>

            {!session.extractionComplete && (
              <Button
                className="mt-4"
                disabled={
                  session.processing
                }
                onClick={
                  run
                }
              >
                {session.processing ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />

                    Extracting...
                  </>
                ) : (
                  <>
                    <ScanDocumentIcon
                      size={15}
                    />

                    <span className="ml-2">
                      Extract Data
                    </span>
                  </>
                )}
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <div className="mb-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Document Date
                </Label>

                <Input
                  type="date"
                  value={
                    session.documentDate
                  }
                  onChange={(
                    event
                  ) =>
                    setSession(
                      (
                        current
                      ) =>
                        current
                          ? {
                              ...current,

                              documentDate:
                                event
                                  .target
                                  .value,
                            }
                          : current
                    )
                  }
                />

                <p className="text-[10px] text-muted-foreground">
                  Used to organize the document in TES history.
                </p>
              </div>
            </div>

            {session.mode ===
              "authority" &&
              session.authorityDraft && (
                <AuthorityForm
                  draft={
                    session.authorityDraft
                  }
                  profile={
                    profile
                  }
                  onChange={(
                    authorityDraft
                  ) =>
                    setSession(
                      (
                        current
                      ) =>
                        current
                          ? {
                              ...current,

                              authorityDraft,
                            }
                          : current
                    )
                  }
                />
              )}

            {session.mode ===
              "safety" &&
              session.safetyDraft && (
                <SafetyForm
                  draft={
                    session.safetyDraft
                  }
                  onChange={(
                    safetyDraft
                  ) =>
                    setSession(
                      (
                        current
                      ) =>
                        current
                          ? {
                              ...current,

                              safetyDraft,
                            }
                          : current
                    )
                  }
                />
              )}

            {session.mode ===
              "audit" &&
              session.auditDraft && (
                <AuditForm
                  draft={
                    session.auditDraft
                  }
                  onChange={(
                    auditDraft
                  ) =>
                    setSession(
                      (
                        current
                      ) =>
                        current
                          ? {
                              ...current,

                              auditDraft,
                            }
                          : current
                    )
                  }
                />
              )}
          </div>

          <div className="flex justify-end border-t p-4">
            <Button
              disabled={
                !ready
              }
              onClick={
                onSave
              }
            >
              <CheckCircle2 className="mr-2 size-4" />

              Save Record
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   ROWS
========================================================= */

function AuthorityRow({
  record,
  rules,
  selected,
  onClick,
}: {
  record:
    AuthorityRecord

  rules:
    DeadlineRules

  selected:
    boolean

  onClick:
    () => void
}) {
  const deadline =
    record.authorityType ===
    "MCS150"
      ? record.nextActionDate
      : record.expiryDate

  const deadlineStatus =
    getDeadlineStatus(
      deadline,
      rules
    )

  const style =
    statusClasses(
      deadlineStatus
    )

  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`grid w-full gap-4 border-l-4 p-4 text-left transition-colors md:grid-cols-12 ${style.left} ${
        selected
          ? "bg-primary/[0.045]"
          : "hover:bg-muted/25"
      }`}
    >
      <div className="md:col-span-3">
        <p className="text-sm font-semibold">
          {
            record.name
          }
        </p>

        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {
            record.id
          }
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="select-text font-mono text-xs font-medium">
          {
            record.number ||
            "—"
          }
        </p>

        <p className="mt-1 text-[10px] text-muted-foreground">
          {record.issuingAuthority ||
            "Issuing authority not recorded"}
        </p>
      </div>

      <div className="md:col-span-2">
        <p className="text-xs font-medium">
          {
            record.jurisdictionLabel
          }
        </p>

        <p className="mt-1 text-[10px] text-muted-foreground">
          {
            record.country
          }
        </p>
      </div>

      <div className="md:col-span-2">
        <p className="text-[10px] text-muted-foreground">
          {record.authorityType ===
          "MCS150"
            ? "Next Action"
            : "Expiry"}
        </p>

        <p className="mt-1 text-xs font-medium">
          {deadline ||
            "—"}
        </p>
      </div>

      <div className="flex items-center justify-end md:col-span-2">
        <DeadlineBadge
          status={
            deadlineStatus
          }
        />
      </div>
    </button>
  )
}

function SafetyRow({
  record,
  selected,
  onClick,
}: {
  record:
    SafetyRecord

  selected:
    boolean

  onClick:
    () => void
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
        selected
          ? "bg-primary/[0.045]"
          : "hover:bg-muted/25"
      }`}
    >
      <div className="md:col-span-4">
        <p className="text-sm font-semibold">
          {record.system ===
          "CARRIER_PROFILE_CVOR"
            ? "Carrier Profile / CVOR"
            : "SMS Profile"}
        </p>

        <p className="mt-1 text-[10px] text-muted-foreground">
          {
            record.jurisdictionLabel
          }
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="text-[10px] text-muted-foreground">
          Review Date
        </p>

        <p className="mt-1 text-xs font-medium">
          {
            record.reviewDate
          }
        </p>
      </div>

      <div className="md:col-span-5">
        <p className="text-xs">
          {record.summary ||
            "No summary recorded."}
        </p>
      </div>
    </button>
  )
}

function AuditRow({
  record,
  selected,
  onClick,
}: {
  record:
    AuditRecord

  selected:
    boolean

  onClick:
    () => void
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
        selected
          ? "bg-primary/[0.045]"
          : "hover:bg-muted/25"
      }`}
    >
      <div className="md:col-span-3">
        <p className="text-sm font-semibold">
          {
            record.auditType
          }
        </p>

        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {record.referenceNumber ||
            record.id}
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="text-xs font-medium">
          {
            record.regulator
          }
        </p>

        <p className="mt-1 text-[10px] text-muted-foreground">
          {
            record.jurisdictionLabel
          }
        </p>
      </div>

      <div className="md:col-span-2">
        <p className="text-[10px] text-muted-foreground">
          Due
        </p>

        <p className="mt-1 text-xs">
          {
            record.dueDate ||
            "—"
          }
        </p>
      </div>

      <div className="md:col-span-2">
        <p className="text-[10px] text-muted-foreground">
          Completed
        </p>

        <p className="mt-1 text-xs">
          {
            record.completedDate ||
            "—"
          }
        </p>
      </div>

      <div className="flex justify-end md:col-span-2">
        <Badge variant="outline">
          {
            record.status
          }
        </Badge>
      </div>
    </button>
  )
}

/* =========================================================
   AUTHORITY SECTION
========================================================= */

function AuthoritySection({
  title,
  description,
  records,
  rules,
  selectedId,
  onSelect,
  onScan,
  onManual,
}: {
  title:
    string

  description:
    string

  records:
    AuthorityRecord[]

  rules:
    DeadlineRules

  selectedId?:
    string

  onSelect:
    (
      record:
        AuthorityRecord
    ) => void

  onScan:
    () => void

  onManual:
    () => void
}) {
  return (
    <Card>
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <CardTitle className="text-sm">
              {title}
            </CardTitle>

            <CardDescription className="mt-1 text-xs">
              {description}
            </CardDescription>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={
                onScan
              }
            >
              <ScanDocumentIcon
                size={14}
              />

              <span className="ml-2">
                Scan Document
              </span>
            </Button>

            <Button
              variant="outline"
              onClick={
                onManual
              }
            >
              <Plus className="mr-2 size-4" />

              Add Record
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {records.length ===
        0 ? (
          <div className="p-10 text-center">
            <Landmark className="mx-auto size-9 text-muted-foreground/30" />

            <p className="mt-3 text-sm font-medium">
              No records found.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {records.map(
              (record) => (
                <AuthorityRow
                  key={
                    record.id
                  }
                  record={
                    record
                  }
                  rules={
                    rules
                  }
                  selected={
                    selectedId ===
                    record.id
                  }
                  onClick={() =>
                    onSelect(
                      record
                    )
                  }
                />
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* =========================================================
   SAFETY SECTION
========================================================= */

function SafetySection({
  title,
  records,
  selected,
  onSelect,
  onScan,
  onManual,
}: {
  title:
    string

  records:
    SafetyRecord[]

  selected:
    SelectedRecord | null

  onSelect:
    (
      record:
        SafetyRecord
    ) => void

  onScan:
    () => void

  onManual:
    () => void
}) {
  return (
    <Card>
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <CardTitle className="text-sm">
              {title}
            </CardTitle>

            <CardDescription className="mt-1 text-xs">
              High-level safety snapshot. Full scoring architecture will be developed separately.
            </CardDescription>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={
                onScan
              }
            >
              <ScanDocumentIcon
                size={14}
              />

              <span className="ml-2">
                Scan Document
              </span>
            </Button>

            <Button
              variant="outline"
              onClick={
                onManual
              }
            >
              <Plus className="mr-2 size-4" />

              Add Snapshot
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {records.length ===
        0 ? (
          <div className="p-10 text-center">
            <ShieldCheck className="mx-auto size-9 text-muted-foreground/30" />

            <p className="mt-3 text-sm font-medium">
              No safety snapshot found.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {records.map(
              (record) => (
                <SafetyRow
                  key={
                    record.id
                  }
                  record={
                    record
                  }
                  selected={
                    selected?.kind ===
                      "safety" &&
                    selected.record.id ===
                      record.id
                  }
                  onClick={() =>
                    onSelect(
                      record
                    )
                  }
                />
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* =========================================================
   EVIDENCE HISTORY
========================================================= */

function EvidenceHistory({
  evidence,
  onPreview,
}: {
  evidence:
    AuthorityEvidence[]

  onPreview:
    (
      evidence:
        AuthorityEvidence
    ) => void
}) {
  const [
    showOlder,
    setShowOlder,
  ] =
    useState(false)

  const sorted =
    [
      ...evidence,
    ].sort(
      (a, b) =>
        (
          b.documentDate ||
          b.uploadedAt
        ).localeCompare(
          a.documentDate ||
          a.uploadedAt
        )
    )

  const recent =
    sorted.filter(
      (item) =>
        isDateInsideThreeYears(
          item.documentDate ||
          item.uploadedAt
        )
    )

  const older =
    sorted.filter(
      (item) =>
        !isDateInsideThreeYears(
          item.documentDate ||
          item.uploadedAt
        )
    )

  const visible =
    showOlder
      ? sorted
      : recent

  return (
    <section className="border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Documents & 3-Year History
          </p>

          <p className="mt-1 text-[10px] text-muted-foreground">
            OCR confidence does not prevent optional human inspection of the original source.
          </p>
        </div>

        {older.length >
          0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px]"
            onClick={() =>
              setShowOlder(
                (current) =>
                  !current
              )
            }
          >
            <History className="mr-1 size-3" />

            {showOlder
              ? "Standard View"
              : `Older History (${older.length})`}
          </Button>
        )}
      </div>

      {visible.length ===
      0 ? (
        <div className="mt-3 rounded-lg border border-dashed p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No supporting documents attached.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {visible.map(
            (item) => (
              <button
                key={
                  item.id
                }
                type="button"
                onClick={() =>
                  onPreview(
                    item
                  )
                }
                className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.025]"
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-primary" />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {
                      item.fileName
                    }
                  </p>

                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {item.documentDate ||
                      item.uploadedAt.slice(
                        0,
                        10
                      )}

                    {item.ocrConfidence !==
                      undefined &&
                      ` · OCR ${item.ocrConfidence}%`}
                  </p>
                </div>

                <span className="text-[10px] font-medium text-primary">
                  Preview
                </span>
              </button>
            )
          )}
        </div>
      )}
    </section>
  )
}

/* =========================================================
   INSPECTOR
========================================================= */

function RecordInspector({
  selected,
  evidence,
  rules,
  onClose,
  onEdit,
  onDelete,
  onPreview,
}: {
  selected:
    SelectedRecord | null

  evidence:
    AuthorityEvidence[]

  rules:
    DeadlineRules

  onClose:
    () => void

  onEdit:
    () => void

  onDelete:
    () => void

  onPreview:
    (
      evidence:
        AuthorityEvidence
    ) => void
}) {
  if (!selected) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-[520px] flex-col items-center justify-center p-10 text-center">
          <Landmark className="size-10 text-muted-foreground/30" />

          <p className="mt-4 text-sm font-medium">
            Select a record
          </p>

          <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted-foreground">
            Open a record to review identifiers, dates, documents and history.
          </p>
        </CardContent>
      </Card>
    )
  }

  const record =
    selected.record

  const attached =
    evidence.filter(
      (item) =>
        record.evidenceIds.includes(
          item.id
        )
    )

  const title =
    selected.kind ===
    "authority"
      ? selected.record.name
      : selected.kind ===
          "safety"
        ? selected.record.system ===
            "CARRIER_PROFILE_CVOR"
          ? "Carrier Profile / CVOR"
          : "SMS Profile"
        : selected.record.auditType

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-primary/[0.03]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {title}
            </CardTitle>

            <CardDescription className="mt-1 font-mono text-[10px]">
              {
                record.id
              }
            </CardDescription>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={
              onClose
            }
          >
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        {selected.kind ===
          "authority" && (
          <>
            <CopyField
              label="Number"
              value={
                selected.record.number
              }
            />

            <CopyField
              label="Issuing Authority"
              value={
                selected.record.issuingAuthority
              }
            />

            <CopyField
              label="Jurisdiction"
              value={
                selected.record.jurisdictionLabel
              }
            />

            <CopyField
              label="Country"
              value={
                selected.record.country
              }
            />

            <CopyField
              label="Status"
              value={
                selected.record.status
              }
            />

            {selected.record.authorityType ===
            "MCS150" ? (
              <>
                <CopyField
                  label="Filed / Update Date"
                  value={
                    selected.record.eventDate
                  }
                />

                <CopyField
                  label="Next Action Date"
                  value={
                    selected.record.nextActionDate
                  }
                />

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Deadline Status
                  </p>

                  <div className="mt-2">
                    <DeadlineBadge
                      status={getDeadlineStatus(
                        selected.record.nextActionDate,
                        rules
                      )}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <CopyField
                  label="Issue Date"
                  value={
                    selected.record.issueDate
                  }
                />

                <CopyField
                  label="Effective Date"
                  value={
                    selected.record.effectiveDate
                  }
                />

                <CopyField
                  label="Expiry Date"
                  value={
                    selected.record.expiryDate
                  }
                />

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Deadline Status
                  </p>

                  <div className="mt-2">
                    <DeadlineBadge
                      status={getDeadlineStatus(
                        selected.record.expiryDate,
                        rules
                      )}
                    />
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {selected.kind ===
          "safety" && (
          <>
            <CopyField
              label="Jurisdiction"
              value={
                selected.record.jurisdictionLabel
              }
            />

            <CopyField
              label="Country"
              value={
                selected.record.country
              }
            />

            <CopyField
              label="Review Date"
              value={
                selected.record.reviewDate
              }
            />

            <CopyField
              label="Summary"
              value={
                selected.record.summary
              }
            />

            <div className="rounded-lg border border-dashed bg-muted/20 p-3">
              <p className="text-[11px] leading-5 text-muted-foreground">
                Detailed Safety Performance architecture will be built separately after the main portal pages are completed.
              </p>
            </div>
          </>
        )}

        {selected.kind ===
          "audit" && (
          <>
            <CopyField
              label="Regulator"
              value={
                selected.record.regulator
              }
            />

            <CopyField
              label="Jurisdiction"
              value={
                selected.record.jurisdictionLabel
              }
            />

            <CopyField
              label="Reference"
              value={
                selected.record.referenceNumber
              }
            />

            <CopyField
              label="Notice Date"
              value={
                selected.record.noticeDate
              }
            />

            <CopyField
              label="Due Date"
              value={
                selected.record.dueDate
              }
            />

            <CopyField
              label="Completed Date"
              value={
                selected.record.completedDate
              }
            />

            <CopyField
              label="Status"
              value={
                selected.record.status
              }
            />

            <CopyField
              label="Outcome"
              value={
                selected.record.outcome
              }
            />

            <CopyField
              label="Score / Rating"
              value={
                selected.record.score
              }
            />
          </>
        )}

        <EvidenceHistory
          evidence={
            attached
          }
          onPreview={
            onPreview
          }
        />

        <div className="flex gap-2 border-t pt-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={
              onEdit
            }
          >
            <Pencil className="mr-2 size-4" />

            Edit
          </Button>

          <Button
            variant="outline"
            className="flex-1 text-destructive hover:text-destructive"
            onClick={
              onDelete
            }
          >
            <Trash2 className="mr-2 size-4" />

            Delete
          </Button>
        </div>

        <p className="text-[10px] leading-4 text-muted-foreground">
          Delete remains available during development. It will become Archive before production.
        </p>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function AuthoritiesPage() {
  const params =
    useParams()

  const router =
    useRouter()

  const companyId =
    params.id as string

  const deviceInputRef =
    useRef<HTMLInputElement | null>(
      null
    )

  const [
    company,
    setCompany,
  ] =
    useState<Company | null>(
      null
    )

  const [
    data,
    setData,
  ] =
    useState<StoredAuthoritiesData>(
      EMPTY_DATA
    )

  const [
    rules,
    setRules,
  ] =
    useState<DeadlineRules>(
      DEFAULT_DEADLINE_RULES
    )

  const [
    loading,
    setLoading,
  ] =
    useState(true)

  const [
    showOlderHistory,
    setShowOlderHistory,
  ] =
    useState(false)

  const [
    selected,
    setSelected,
  ] =
    useState<SelectedRecord | null>(
      null
    )

  const [
    previewEvidence,
    setPreviewEvidence,
  ] =
    useState<AuthorityEvidence | null>(
      null
    )

  const [
    manualState,
    setManualState,
  ] =
    useState<ManualState | null>(
      null
    )

  const [
    editingState,
    setEditingState,
  ] =
    useState<ManualState | null>(
      null
    )

  const [
    sourceContext,
    setSourceContext,
  ] =
    useState<{
      mode:
        | "authority"
        | "safety"
        | "audit"

      category?:
        AuthorityCategory

      authorityType?:
        AuthorityType

      safetySystem?:
        SafetySystem
    } | null>(
      null
    )

  const [
    showCamera,
    setShowCamera,
  ] =
    useState(false)

  const [
    ocrSession,
    setOcrSession,
  ] =
    useState<OCRSession | null>(
      null
    )

  const storageKey =
    `tes_company_authorities_${companyId}`

  /* =======================================================
     LOAD
  ======================================================= */

  useEffect(() => {
    try {
      const found =
        getCompanies().find(
          (item) =>
            item.id ===
            companyId
        )

      setCompany(
        found ||
        null
      )

      const raw =
        localStorage.getItem(
          storageKey
        )

      if (raw) {
        const parsed =
          JSON.parse(raw)

        setData({
          ...EMPTY_DATA,

          ...parsed,

          authorities:
            Array.isArray(
              parsed.authorities
            )
              ? parsed.authorities
              : [],

          safety:
            Array.isArray(
              parsed.safety
            )
              ? parsed.safety
              : [],

          audits:
            Array.isArray(
              parsed.audits
            )
              ? parsed.audits
              : [],

          evidence:
            Array.isArray(
              parsed.evidence
            )
              ? parsed.evidence
              : [],
        })
      }

      setRules(
        loadDeadlineRules()
      )
    } catch (
      error
    ) {
      console.error(
        "Unable to load Authorities page",
        error
      )
    } finally {
      setLoading(
        false
      )
    }
  }, [
    companyId,
    storageKey,
  ])

  /* =======================================================
     PERSIST
  ======================================================= */

  useEffect(() => {
    if (!loading) {
      localStorage.setItem(
        storageKey,

        JSON.stringify(
          data
        )
      )
    }
  }, [
    data,
    loading,
    storageKey,
  ])

  const profile =
    useMemo(
      () =>
        company
          ? deriveAuthorityProfile(
              company
            )
          : null,

      [
        company,
      ]
    )

  /* =======================================================
     3-YEAR RECORD WINDOW
  ======================================================= */

  const filteredAuthorities =
    data.authorities.filter(
      (record) =>
        showOlderHistory ||
        isDateInsideThreeYears(
          authorityReferenceDate(
            record
          )
        )
    )

  const filteredSafety =
    data.safety.filter(
      (record) =>
        showOlderHistory ||
        isDateInsideThreeYears(
          safetyReferenceDate(
            record
          )
        )
    )

  const filteredAudits =
    data.audits.filter(
      (record) =>
        showOlderHistory ||
        isDateInsideThreeYears(
          auditReferenceDate(
            record
          )
        )
    )

  const olderRecordCount =
    [
      ...data.authorities.filter(
        (record) =>
          !isDateInsideThreeYears(
            authorityReferenceDate(
              record
            )
          )
      ),

      ...data.safety.filter(
        (record) =>
          !isDateInsideThreeYears(
            safetyReferenceDate(
              record
            )
          )
      ),

      ...data.audits.filter(
        (record) =>
          !isDateInsideThreeYears(
            auditReferenceDate(
              record
            )
          )
      ),
    ].length

  const categoryAuthorities =
    (
      category:
        AuthorityCategory
    ) =>
      filteredAuthorities.filter(
        (record) =>
          record.category ===
          category
      )

  /* =======================================================
     SAVE AUTHORITY
  ======================================================= */

  const saveAuthority =
    (
      draft:
        AuthorityDraft,

      source:
        SourceType,

      evidence?:
        AuthorityEvidence,

      editingId?:
        string
    ) => {
      const conflict =
        findGlobalAuthorityConflict({
          currentCompanyId:
            companyId,

          authorityType:
            draft.authorityType,

          number:
            draft.number,

          editingId,
        })

      if (conflict) {
        if (
          conflict.sameCompany
        ) {
          window.alert(
            `This identifier already exists for this company.\n\nOpen the existing ${draft.name} record instead of creating a duplicate.`
          )
        } else {
          window.alert(
            `Duplicate identifier conflict.\n\n${draft.name} ${draft.number} is already connected to ${conflict.companyName} (${conflict.companyId}). TES will not create a second authoritative record.`
          )
        }

        return false
      }

      const now =
        isoNow()

      if (
        editingId
      ) {
        setData(
          (current) => ({
            ...current,

            authorities:
              current.authorities.map(
                (record) =>
                  record.id ===
                  editingId
                    ? {
                        ...record,

                        ...draft,

                        evidenceIds:
                          evidence
                            ? Array.from(
                                new Set([
                                  ...record.evidenceIds,

                                  evidence.id,
                                ])
                              )
                            : record.evidenceIds,

                        source,

                        updatedAt:
                          now,
                      }
                    : record
              ),

            evidence:
              evidence
                ? [
                    {
                      ...evidence,

                      recordId:
                        editingId,
                    },

                    ...current.evidence,
                  ]
                : current.evidence,
          })
        )

        return true
      }

      const record:
        AuthorityRecord =
        {
          id:
            createId(
              "AUTH"
            ),

          ...draft,

          evidenceIds:
            evidence
              ? [
                  evidence.id,
                ]
              : [],

          source,

          createdAt:
            now,

          updatedAt:
            now,
        }

      setData(
        (current) => ({
          ...current,

          authorities:
            [
              record,

              ...current.authorities,
            ],

          evidence:
            evidence
              ? [
                  {
                    ...evidence,

                    recordId:
                      record.id,
                  },

                  ...current.evidence,
                ]
              : current.evidence,
        })
      )

      setSelected({
        kind:
          "authority",

        record,
      })

      return true
    }

  /* =======================================================
     SAVE SAFETY
  ======================================================= */

  const saveSafety =
    (
      draft:
        SafetyDraft,

      source:
        SourceType,

      evidence?:
        AuthorityEvidence,

      editingId?:
        string
    ) => {
      const now =
        isoNow()

      if (
        editingId
      ) {
        setData(
          (current) => ({
            ...current,

            safety:
              current.safety.map(
                (record) =>
                  record.id ===
                  editingId
                    ? {
                        ...record,

                        ...draft,

                        evidenceIds:
                          evidence
                            ? Array.from(
                                new Set([
                                  ...record.evidenceIds,

                                  evidence.id,
                                ])
                              )
                            : record.evidenceIds,

                        source,

                        updatedAt:
                          now,
                      }
                    : record
              ),

            evidence:
              evidence
                ? [
                    {
                      ...evidence,

                      recordId:
                        editingId,
                    },

                    ...current.evidence,
                  ]
                : current.evidence,
          })
        )

        return
      }

      const record:
        SafetyRecord =
        {
          id:
            createId(
              "SAFE"
            ),

          ...draft,

          evidenceIds:
            evidence
              ? [
                  evidence.id,
                ]
              : [],

          source,

          createdAt:
            now,

          updatedAt:
            now,
        }

      setData(
        (current) => ({
          ...current,

          safety:
            [
              record,

              ...current.safety,
            ],

          evidence:
            evidence
              ? [
                  {
                    ...evidence,

                    recordId:
                      record.id,
                  },

                  ...current.evidence,
                ]
              : current.evidence,
        })
      )

      setSelected({
        kind:
          "safety",

        record,
      })
    }

  /* =======================================================
     SAVE AUDIT
  ======================================================= */

  const saveAudit =
    (
      draft:
        AuditDraft,

      source:
        SourceType,

      evidence?:
        AuthorityEvidence,

      editingId?:
        string
    ) => {
      const now =
        isoNow()

      if (
        editingId
      ) {
        setData(
          (current) => ({
            ...current,

            audits:
              current.audits.map(
                (record) =>
                  record.id ===
                  editingId
                    ? {
                        ...record,

                        ...draft,

                        evidenceIds:
                          evidence
                            ? Array.from(
                                new Set([
                                  ...record.evidenceIds,

                                  evidence.id,
                                ])
                              )
                            : record.evidenceIds,

                        source,

                        updatedAt:
                          now,
                      }
                    : record
              ),

            evidence:
              evidence
                ? [
                    {
                      ...evidence,

                      recordId:
                        editingId,
                    },

                    ...current.evidence,
                  ]
                : current.evidence,
          })
        )

        return
      }

      const record:
        AuditRecord =
        {
          id:
            createId(
              "AUD"
            ),

          ...draft,

          evidenceIds:
            evidence
              ? [
                  evidence.id,
                ]
              : [],

          source,

          createdAt:
            now,

          updatedAt:
            now,
        }

      setData(
        (current) => ({
          ...current,

          audits:
            [
              record,

              ...current.audits,
            ],

          evidence:
            evidence
              ? [
                  {
                    ...evidence,

                    recordId:
                      record.id,
                  },

                  ...current.evidence,
                ]
              : current.evidence,
        })
      )

      setSelected({
        kind:
          "audit",

        record,
      })
    }

  /* =======================================================
     DELETE — DEVELOPMENT ONLY
  ======================================================= */

  const deleteSelected =
    () => {
      if (!selected) {
        return
      }

      if (
        !window.confirm(
          "Delete this development/test record? This function will become Archive before production."
        )
      ) {
        return
      }

      const id =
        selected.record.id

      setData(
        (current) => ({
          ...current,

          authorities:
            selected.kind ===
            "authority"
              ? current.authorities.filter(
                  (record) =>
                    record.id !==
                    id
                )
              : current.authorities,

          safety:
            selected.kind ===
            "safety"
              ? current.safety.filter(
                  (record) =>
                    record.id !==
                    id
                )
              : current.safety,

          audits:
            selected.kind ===
            "audit"
              ? current.audits.filter(
                  (record) =>
                    record.id !==
                    id
                )
              : current.audits,

          evidence:
            current.evidence.filter(
              (item) =>
                !selected.record.evidenceIds.includes(
                  item.id
                )
            ),
        })
      )

      setSelected(
        null
      )
    }

  /* =======================================================
     EDIT
  ======================================================= */

  const openEdit =
    () => {
      if (!selected) {
        return
      }

      if (
        selected.kind ===
        "authority"
      ) {
        const record =
          selected.record

        setEditingState({
          mode:
            "authority",

          draft: {
            category:
              record.category,

            authorityType:
              record.authorityType,

            name:
              record.name,

            number:
              record.number,

            issuingAuthority:
              record.issuingAuthority,

            jurisdictionCode:
              record.jurisdictionCode,

            jurisdictionLabel:
              record.jurisdictionLabel,

            country:
              record.country,

            status:
              record.status,

            issueDate:
              record.issueDate ||
              "",

            effectiveDate:
              record.effectiveDate ||
              "",

            expiryDate:
              record.expiryDate ||
              "",

            eventDate:
              record.eventDate ||
              "",

            nextActionDate:
              record.nextActionDate ||
              "",

            notes:
              record.notes ||
              "",
          },
        })

        return
      }

      if (
        selected.kind ===
        "safety"
      ) {
        const record =
          selected.record

        setEditingState({
          mode:
            "safety",

          draft: {
            system:
              record.system,

            jurisdictionCode:
              record.jurisdictionCode,

            jurisdictionLabel:
              record.jurisdictionLabel,

            country:
              record.country,

            reviewDate:
              record.reviewDate,

            summary:
              record.summary,

            notes:
              record.notes ||
              "",
          },
        })

        return
      }

      const record =
        selected.record

      setEditingState({
        mode:
          "audit",

        draft: {
          auditType:
            record.auditType,

          regulator:
            record.regulator,

          jurisdictionCode:
            record.jurisdictionCode,

          jurisdictionLabel:
            record.jurisdictionLabel,

          country:
            record.country,

          referenceNumber:
            record.referenceNumber,

          noticeDate:
            record.noticeDate ||
            "",

          dueDate:
            record.dueDate ||
            "",

          completedDate:
            record.completedDate ||
            "",

          status:
            record.status,

          outcome:
            record.outcome ||
            "",

          score:
            record.score ||
            "",

          followUpRequired:
            record.followUpRequired,

          followUpDueDate:
            record.followUpDueDate ||
            "",

          notes:
            record.notes ||
            "",
        },
      })
    }

  /* =======================================================
     START OCR
  ======================================================= */

  const startOCRFile =
    async (
      file:
        File,

      source:
        DocumentSource
    ) => {
      if (
        !sourceContext ||
        !company ||
        !profile
      ) {
        return
      }

      if (
        !file.type.startsWith(
          "image/"
        ) &&
        file.type !==
          "application/pdf"
      ) {
        window.alert(
          "Please select a PDF or image."
        )

        return
      }

      const dataUrl =
        await readFileAsDataUrl(
          file
        )

      if (
        sourceContext.mode ===
        "authority"
      ) {
        const category =
          sourceContext.category!

        const options =
          authorityOptions(
            category,
            profile
          )

        const type =
          sourceContext.authorityType ||
          options[0]?.value ||
          "OTHER"

        setOcrSession({
          mode:
            "authority",

          source,

          file,

          dataUrl,

          processing:
            false,

          extractionComplete:
            false,

          documentDate:
            todayISO(),

          authorityDraft:
            emptyAuthorityDraft(
              company,
              category,
              type
            ),
        })
      } else if (
        sourceContext.mode ===
        "safety"
      ) {
        setOcrSession({
          mode:
            "safety",

          source,

          file,

          dataUrl,

          processing:
            false,

          extractionComplete:
            false,

          documentDate:
            todayISO(),

          safetyDraft:
            emptySafetyDraft(
              company,
              sourceContext.safetySystem!
            ),
        })
      } else {
        setOcrSession({
          mode:
            "audit",

          source,

          file,

          dataUrl,

          processing:
            false,

          extractionComplete:
            false,

          documentDate:
            todayISO(),

          auditDraft:
            emptyAuditDraft(
              company
            ),
        })
      }

      setSourceContext(
        null
      )
    }

  /* =======================================================
     SAVE OCR
  ======================================================= */

  const saveOCR =
    () => {
      if (!ocrSession) {
        return
      }

      const evidence:
        AuthorityEvidence =
        {
          id:
            createId(
              "DOC"
            ),

          fileName:
            ocrSession.file.name,

          mimeType:
            ocrSession.file.type,

          dataUrl:
            ocrSession.dataUrl,

          documentDate:
            ocrSession.documentDate,

          uploadedAt:
            isoNow(),

          source:
            ocrSession.source,

          ocrConfidence:
            ocrSession.confidence,
        }

      if (
        ocrSession.mode ===
          "authority" &&
        ocrSession.authorityDraft
      ) {
        const saved =
          saveAuthority(
            ocrSession.authorityDraft,

            "OCR",

            evidence
          )

        if (saved) {
          setOcrSession(
            null
          )
        }

        return
      }

      if (
        ocrSession.mode ===
          "safety" &&
        ocrSession.safetyDraft
      ) {
        saveSafety(
          ocrSession.safetyDraft,

          "OCR",

          evidence
        )

        setOcrSession(
          null
        )

        return
      }

      if (
        ocrSession.mode ===
          "audit" &&
        ocrSession.auditDraft
      ) {
        saveAudit(
          ocrSession.auditDraft,

          "OCR",

          evidence
        )

        setOcrSession(
          null
        )
      }
    }

  /* =======================================================
     PAGE STATES
  ======================================================= */

  if (
    loading
  ) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (
    !company ||
    !profile
  ) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Building2 className="size-10 text-muted-foreground/40" />

        <h2 className="text-lg font-semibold">
          Company Not Found
        </h2>

        <Button
          variant="outline"
          onClick={() =>
            router.push(
              "/companies"
            )
          }
        >
          <ArrowLeft className="mr-2 size-4" />

          Companies
        </Button>
      </div>
    )
  }

  /* =======================================================
     SUMMARY
  ======================================================= */

  const deadlineStatuses =
    filteredAuthorities.map(
      (record) =>
        getDeadlineStatus(
          record.authorityType ===
          "MCS150"
            ? record.nextActionDate
            : record.expiryDate,

          rules
        )
    )

  const countStatus =
    (
      status:
        DeadlineStatus
    ) =>
      deadlineStatuses.filter(
        (item) =>
          item ===
          status
      ).length

  const registrations =
    categoryAuthorities(
      "operating_registration"
    ).filter(
      (record) => {
        if (
          record.authorityType ===
          "PHMSA"
        ) {
          return profile.showPHMSA
        }

        if (
          record.authorityType ===
          "UCR"
        ) {
          return profile.showUCR
        }

        return true
      }
    )

  const showOperatingRegistrations =
    profile.showUCR ||
    profile.showPHMSA

  return (
    <>
      <div className="flex max-w-[1600px] flex-col gap-6 pb-12">
        {/* HEADER */}

        <div>
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                router.push(
                  `/companies/${company.id}/profile`
                )
              }
            >
              <ArrowLeft className="size-4" />
            </Button>

            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Operating Authorities & Registrations
              </h1>

              <p className="mt-1 text-sm text-muted-foreground">
                {company.name}{" "}

                <span className="font-mono text-xs">
                  ({company.id})
                </span>
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
                  {company.regCorpState ||
                    "Unknown"}
                  ,{" "}
                  {company.regCorpCountry ||
                    "Unknown"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Operating Region
                </p>

                <p className="mt-1 text-sm font-semibold">
                  {company.region ||
                    "Not specified"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Cargo / Hazmat
                </p>

                <p className="mt-1 text-sm font-semibold">
                  {profile.hazmat
                    ? "Hazmat operation"
                    : "No Hazmat trigger"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border lg:block" />

              <button
                type="button"
                onClick={() =>
                  setRules(
                    loadDeadlineRules()
                  )
                }
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <RefreshCcw className="size-3" />

                Refresh Deadline Settings
              </button>
            </div>
          </div>
        </div>

        {/* DEADLINES */}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(
            [
              "Healthy",
              "Watch",
              "Urgent",
              "Critical",
              "Expired",
            ] as
              DeadlineStatus[]
          ).map(
            (status) => {
              const style =
                statusClasses(
                  status
                )

              return (
                <Card
                  key={
                    status
                  }
                  className={`border-l-4 ${style.left}`}
                >
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">
                      {status}
                    </p>

                    <div className="mt-2 flex items-end justify-between gap-2">
                      <p className="text-2xl font-bold">
                        {
                          countStatus(
                            status
                          )
                        }
                      </p>

                      <DeadlineBadge
                        status={
                          status
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              )
            }
          )}
        </div>

        {/* 3 YEAR RULE */}

        <Card className="border-primary/15 bg-primary/[0.025]">
          <CardContent className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <History className="mt-0.5 size-4 text-primary" />

              <div>
                <p className="text-xs font-semibold">
                  Standard 3-Year Operational History
                </p>

                <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                  The normal TES view keeps at least the most recent three years of records and documents readily visible. Older retained history remains available for extended audit requests.
                </p>
              </div>
            </div>

            {olderRecordCount >
              0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setShowOlderHistory(
                    (current) =>
                      !current
                  )
                }
              >
                <History className="mr-2 size-4" />

                {showOlderHistory
                  ? "Show Standard View"
                  : `Show Older History (${olderRecordCount})`}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* MAIN */}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-6">
            {/* CANADA */}

            {profile.showCanadian && (
              <AuthoritySection
                title="Canadian Operations"
                description="Provincial carrier identifier and NSC / Safety Fitness Certificate / CVOR records."
                records={categoryAuthorities(
                  "canadian"
                )}
                rules={
                  rules
                }
                selectedId={
                  selected?.kind ===
                  "authority"
                    ? selected.record.id
                    : undefined
                }
                onSelect={(
                  record
                ) =>
                  setSelected({
                    kind:
                      "authority",

                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode:
                      "authority",

                    category:
                      "canadian",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode:
                      "authority",

                    draft:
                      emptyAuthorityDraft(
                        company,

                        "canadian"
                      ),
                  })
                }
              />
            )}

            {/* US */}

            {profile.showUS && (
              <AuthoritySection
                title="US Federal Operations"
                description="USDOT identifier, MC operating authority and MCS-150 biennial update."
                records={categoryAuthorities(
                  "us_federal"
                )}
                rules={
                  rules
                }
                selectedId={
                  selected?.kind ===
                  "authority"
                    ? selected.record.id
                    : undefined
                }
                onSelect={(
                  record
                ) =>
                  setSelected({
                    kind:
                      "authority",

                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode:
                      "authority",

                    category:
                      "us_federal",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode:
                      "authority",

                    draft:
                      emptyAuthorityDraft(
                        company,

                        "us_federal"
                      ),
                  })
                }
              />
            )}

            {/* UCR + PHMSA */}

            {showOperatingRegistrations && (
              <AuthoritySection
                title="Operating Registrations"
                description={
                  profile.showPHMSA
                    ? "UCR and applicable fleet-level PHMSA registration."
                    : "Carrier-level operating registrations such as UCR."
                }
                records={
                  registrations
                }
                rules={
                  rules
                }
                selectedId={
                  selected?.kind ===
                  "authority"
                    ? selected.record.id
                    : undefined
                }
                onSelect={(
                  record
                ) =>
                  setSelected({
                    kind:
                      "authority",

                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode:
                      "authority",

                    category:
                      "operating_registration",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode:
                      "authority",

                    draft:
                      emptyAuthorityDraft(
                        company,

                        "operating_registration",

                        profile.showUCR
                          ? "UCR"
                          : "PHMSA"
                      ),
                  })
                }
              />
            )}

            {/* CANADIAN SAFETY ONLY IF CANADA APPLIES */}

            {profile.showCarrierProfile && (
              <SafetySection
                title="Carrier Profile / CVOR"
                records={filteredSafety.filter(
                  (record) =>
                    record.system ===
                    "CARRIER_PROFILE_CVOR"
                )}
                selected={
                  selected
                }
                onSelect={(
                  record
                ) =>
                  setSelected({
                    kind:
                      "safety",

                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode:
                      "safety",

                    safetySystem:
                      "CARRIER_PROFILE_CVOR",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode:
                      "safety",

                    draft:
                      emptySafetyDraft(
                        company,

                        "CARRIER_PROFILE_CVOR"
                      ),
                  })
                }
              />
            )}

            {/* SMS ONLY IF US APPLIES */}

            {profile.showSMSProfile && (
              <SafetySection
                title="SMS Profile"
                records={filteredSafety.filter(
                  (record) =>
                    record.system ===
                    "SMS_PROFILE"
                )}
                selected={
                  selected
                }
                onSelect={(
                  record
                ) =>
                  setSelected({
                    kind:
                      "safety",

                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode:
                      "safety",

                    safetySystem:
                      "SMS_PROFILE",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode:
                      "safety",

                    draft:
                      emptySafetyDraft(
                        company,

                        "SMS_PROFILE"
                      ),
                  })
                }
              />
            )}

            {/* AUDITS */}

            <Card>
              <CardHeader className="border-b bg-muted/20">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="text-sm">
                      Audits & Interventions
                    </CardTitle>

                    <CardDescription className="mt-1 text-xs">
                      Regulatory notices, audits, interventions, outcomes and follow-up.
                    </CardDescription>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() =>
                        setSourceContext({
                          mode:
                            "audit",
                        })
                      }
                    >
                      <ScanDocumentIcon
                        size={14}
                      />

                      <span className="ml-2">
                        Scan Notice
                      </span>
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() =>
                        setManualState({
                          mode:
                            "audit",

                          draft:
                            emptyAuditDraft(
                              company
                            ),
                        })
                      }
                    >
                      <Plus className="mr-2 size-4" />

                      Add Audit
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {filteredAudits.length ===
                0 ? (
                  <div className="p-10 text-center">
                    <FileCheck2 className="mx-auto size-9 text-muted-foreground/30" />

                    <p className="mt-3 text-sm font-medium">
                      No audit or intervention records found.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredAudits.map(
                      (
                        record
                      ) => (
                        <AuditRow
                          key={
                            record.id
                          }
                          record={
                            record
                          }
                          selected={
                            selected?.kind ===
                              "audit" &&
                            selected.record.id ===
                              record.id
                          }
                          onClick={() =>
                            setSelected({
                              kind:
                                "audit",

                              record,
                            })
                          }
                        />
                      )
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* RIGHT INSPECTOR */}

          <div className="xl:sticky xl:top-6">
            <RecordInspector
              selected={
                selected
              }
              evidence={
                data.evidence
              }
              rules={
                rules
              }
              onClose={() =>
                setSelected(
                  null
                )
              }
              onEdit={
                openEdit
              }
              onDelete={
                deleteSelected
              }
              onPreview={
                setPreviewEvidence
              }
            />
          </div>
        </div>
      </div>

      {/* MANUAL */}

      {manualState && (
        <ManualModal
          state={
            manualState
          }
          profile={
            profile
          }
          onChange={
            setManualState
          }
          onCancel={() =>
            setManualState(
              null
            )
          }
          onSave={() => {
            if (
              manualState.mode ===
              "authority"
            ) {
              const saved =
                saveAuthority(
                  manualState.draft,

                  "Manual"
                )

              if (saved) {
                setManualState(
                  null
                )
              }

              return
            }

            if (
              manualState.mode ===
              "safety"
            ) {
              saveSafety(
                manualState.draft,

                "Manual"
              )

              setManualState(
                null
              )

              return
            }

            saveAudit(
              manualState.draft,

              "Manual"
            )

            setManualState(
              null
            )
          }}
        />
      )}

      {/* EDIT */}

      {editingState &&
        selected && (
        <ManualModal
          state={
            editingState
          }
          profile={
            profile
          }
          onChange={
            setEditingState
          }
          onCancel={() =>
            setEditingState(
              null
            )
          }
          onSave={() => {
            const editingId =
              selected.record.id

            if (
              editingState.mode ===
              "authority"
            ) {
              const saved =
                saveAuthority(
                  editingState.draft,

                  selected.record.source,

                  undefined,

                  editingId
                )

              if (saved) {
                setSelected({
                  kind:
                    "authority",

                  record: {
                    ...(selected.record as
                      AuthorityRecord),

                    ...editingState.draft,

                    updatedAt:
                      isoNow(),
                  },
                })

                setEditingState(
                  null
                )
              }

              return
            }

            if (
              editingState.mode ===
              "safety"
            ) {
              saveSafety(
                editingState.draft,

                selected.record.source,

                undefined,

                editingId
              )

              setSelected({
                kind:
                  "safety",

                record: {
                  ...(selected.record as
                    SafetyRecord),

                  ...editingState.draft,

                  updatedAt:
                    isoNow(),
                },
              })

              setEditingState(
                null
              )

              return
            }

            saveAudit(
              editingState.draft,

              selected.record.source,

              undefined,

              editingId
            )

            setSelected({
              kind:
                "audit",

              record: {
                ...(selected.record as
                  AuditRecord),

                ...editingState.draft,

                updatedAt:
                  isoNow(),
              },
            })

            setEditingState(
              null
            )
          }}
        />
      )}

      {/* SOURCE */}

      {sourceContext && (
        <DocumentSourcePicker
          onClose={() =>
            setSourceContext(
              null
            )
          }
          onCamera={() =>
            setShowCamera(
              true
            )
          }
          onDevice={() =>
            deviceInputRef.current?.click()
          }
        />
      )}

      {/* CAMERA */}

      {showCamera && (
        <CameraCapture
          onClose={() =>
            setShowCamera(
              false
            )
          }
          onCapture={(
            file
          ) => {
            setShowCamera(
              false
            )

            startOCRFile(
              file,

              "camera"
            )
          }}
        />
      )}

      {/* OCR */}

      {ocrSession && (
        <OCRWorkspace
          session={
            ocrSession
          }
          profile={
            profile
          }
          setSession={
            setOcrSession
          }
          onCancel={() =>
            setOcrSession(
              null
            )
          }
          onReplace={() => {
            const context =
              ocrSession.mode ===
              "authority"
                ? {
                    mode:
                      "authority" as const,

                    category:
                      ocrSession.authorityDraft!.category,

                    authorityType:
                      ocrSession.authorityDraft!.authorityType,
                  }
                : ocrSession.mode ===
                    "safety"
                  ? {
                      mode:
                        "safety" as const,

                      safetySystem:
                        ocrSession.safetyDraft!.system,
                    }
                  : {
                      mode:
                        "audit" as const,
                    }

            setOcrSession(
              null
            )

            setSourceContext(
              context
            )
          }}
          onSave={
            saveOCR
          }
        />
      )}

      {/* SAVED DOCUMENT PREVIEW */}

      {previewEvidence && (
        <DocumentPreviewModal
          evidence={
            previewEvidence
          }
          onClose={() =>
            setPreviewEvidence(
              null
            )
          }
        />
      )}

      {/* DEVICE FILE INPUT */}

      <input
        ref={
          deviceInputRef
        }
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={async (
          event
        ) => {
          const file =
            event.target.files?.[0]

          event.target.value =
            ""

          if (!file) {
            return
          }

          await startOCRFile(
            file,

            "device"
          )
        }}
      />
    </>
  )
}
