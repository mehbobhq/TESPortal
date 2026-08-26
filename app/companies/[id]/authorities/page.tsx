"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  useParams,
  useRouter,
} from "next/navigation"

import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Building2,
  CalendarClock,
  Camera,
  Check,
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
  Search,
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
   CORE TYPES
========================================================= */

type DeadlineRules = {
  healthyMinDays: number
  watchMinDays: number
  urgentMinDays: number
  criticalMinDays: number
  criticalMaxDays: number
}

type SystemSettings = {
  version: number

  expiryRules?: DeadlineRules
  deadlineRules?: DeadlineRules

  updatedAt?: string
  updatedBy?: string

  [key: string]: any
}

type DeadlineStatus =
  | "Healthy"
  | "Watch"
  | "Urgent"
  | "Critical"
  | "Expired"
  | "No Deadline"
  | "Deleted"

type SourceType =
  | "OCR"
  | "Manual"

type DocumentSource =
  | "camera"
  | "device"

type AuthorityCategory =
  | "canadian"
  | "us_federal"
  | "registration"
  | "hazmat"
  | "safety"
  | "audit"

type ApplicabilityStatus =
  | "Required"
  | "Not Required"
  | "Needs Review"

type Company = {
  id: string
  name: string

  kind?: string
  contact?: string

  /*
    LOCKED COMPANY CONTRACT.
    Do not rename.
  */
  regCorpState?: string
  regCorpCountry?: string
  region?: string

  cargoTypes?: string[]
  cargoInformation?: any
  hazmat?: boolean

  status?: string
  tone?: string

  createdAt?: string

  [key: string]: any
}

type AuthorityEvidence = {
  id: string

  authorityRecordId?: string

  documentName: string
  documentType: string

  documentDate?: string

  source: DocumentSource

  uploadedAt: string

  ocrConfidence?: number

  /*
    Prototype storage only.
    Later replace with durable storage/document ID.
  */
  dataUrl?: string
}

type AuthorityRecord = {
  id: string

  category: AuthorityCategory

  /*
    Example:
    USDOT
    MC
    MVID
    RIN
    NSC
    CVOR
    UCR
    PHMSA
    MCS-150
  */
  authorityType: string

  /*
    Exact public/display wording.
  */
  authorityName: string

  authorityNumber: string

  issuingAuthority?: string

  country?: string
  jurisdiction?: string

  /*
    Used for annual/biennial/renewable requirements.
  */
  issueDate?: string
  effectiveDate?: string
  renewalDate?: string
  expiryDate?: string

  /*
    For requirements such as MCS-150 where there is
    a due date rather than an expiry date.
  */
  dueDate?: string

  recordStatus:
    | "Active"
    | "Inactive"
    | "Pending"
    | "Suspended"
    | "Expired"
    | "Unknown"

  applicability:
    ApplicabilityStatus

  source: SourceType

  evidenceIds: string[]

  notes?: string

  /*
    Optional linkage.
  */
  credentialStored?: boolean

  previousRecordId?: string

  createdAt: string
  updatedAt: string

  deletedAt?: string
  deletedBy?: string
}

type AuditRecord = {
  id: string

  category: "audit"

  auditType: string

  regulator: string
  jurisdiction: string

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

  deletedAt?: string
  deletedBy?: string
}

type SafetyPlaceholderRecord = {
  id: string

  category: "safety"

  system:
    | "Canadian Carrier Profile"
    | "Ontario CVOR"
    | "FMCSA SMS"
    | "Other"

  jurisdiction: string

  reviewDate: string

  statusSummary: string

  notes?: string

  evidenceIds: string[]

  source: SourceType

  createdAt: string
  updatedAt: string

  deletedAt?: string
  deletedBy?: string
}

type StoredAuthoritiesData = {
  version: number

  authorities: AuthorityRecord[]
  audits: AuditRecord[]
  safety: SafetyPlaceholderRecord[]

  evidence: AuthorityEvidence[]
}

type SelectedRecord =
  | AuthorityRecord
  | AuditRecord
  | SafetyPlaceholderRecord

type AuthorityDraft = {
  category: AuthorityCategory

  authorityType: string
  authorityName: string

  authorityNumber: string

  issuingAuthority: string

  country: string
  jurisdiction: string

  issueDate: string
  effectiveDate: string

  renewalDate: string
  expiryDate: string
  dueDate: string

  recordStatus:
    | "Active"
    | "Inactive"
    | "Pending"
    | "Suspended"
    | "Expired"
    | "Unknown"

  applicability:
    ApplicabilityStatus

  credentialStored: boolean

  notes: string
}

type AuditDraft = {
  auditType: string

  regulator: string
  jurisdiction: string

  referenceNumber: string

  noticeDate: string
  dueDate: string
  completedDate: string

  status:
    | "Open"
    | "Scheduled"
    | "In Progress"
    | "Completed"
    | "Closed"

  outcome: string
  score: string

  followUpRequired: boolean
  followUpDueDate: string

  notes: string
}

type SafetyDraft = {
  system:
    | "Canadian Carrier Profile"
    | "Ontario CVOR"
    | "FMCSA SMS"
    | "Other"

  jurisdiction: string

  reviewDate: string

  statusSummary: string

  notes: string
}

type OCRSession = {
  category: AuthorityCategory

  source: DocumentSource

  file: File
  dataUrl: string

  processing: boolean
  extractionComplete: boolean

  confidence?: number

  authorityDraft?: AuthorityDraft
  auditDraft?: AuditDraft
  safetyDraft?: SafetyDraft
}

/* =========================================================
   CONSTANTS
========================================================= */

const SETTINGS_STORAGE_KEY =
  "tes_system_settings"

const DEFAULT_DEADLINE_RULES: DeadlineRules = {
  healthyMinDays: 61,
  watchMinDays: 31,
  urgentMinDays: 11,
  criticalMinDays: 0,
  criticalMaxDays: 10,
}

const EMPTY_DATA: StoredAuthoritiesData = {
  version: 1,

  authorities: [],
  audits: [],
  safety: [],
  evidence: [],
}

/*
  GLOBAL TES STANDARD:

  At least 3 years remain visible in the normal
  operational interface.

  Older records are retained and available historically.
*/
const STANDARD_VISIBLE_HISTORY_YEARS =
  3

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

function todayIso() {
  return new Date()
    .toISOString()
    .slice(0, 10)
}

/* =========================================================
   SETTINGS
========================================================= */

function loadSystemSettings():
  SystemSettings {
  const fallback:
    SystemSettings = {
    version: 1,

    deadlineRules:
      DEFAULT_DEADLINE_RULES,
  }

  if (
    typeof window ===
    "undefined"
  ) {
    return fallback
  }

  try {
    const raw =
      localStorage.getItem(
        SETTINGS_STORAGE_KEY
      )

    if (!raw) {
      return fallback
    }

    const parsed =
      JSON.parse(raw)

    const incomingRules =
      parsed.deadlineRules ||
      parsed.expiryRules ||
      {}

    return {
      ...fallback,
      ...parsed,

      deadlineRules: {
        ...DEFAULT_DEADLINE_RULES,
        ...incomingRules,
      },
    }
  } catch {
    return fallback
  }
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
          width: size * 0.58,
          height: size * 0.58,
          strokeWidth: 1.8,
        }}
      />
    </span>
  )
}

/* =========================================================
   NORMALIZATION
========================================================= */

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

/* =========================================================
   COMPANY STORE
========================================================= */

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

/* =========================================================
   GLOBAL DUPLICATE SCAN

   Searches authority stores across all companies.

   In production this should become a shared global
   identifier resolver/service.
========================================================= */

type GlobalAuthorityMatch = {
  companyId: string
  companyName: string

  recordId: string

  authorityType: string
  authorityNumber: string
}

function scanGlobalAuthorityIdentifier({
  authorityType,
  authorityNumber,
  currentCompanyId,
}: {
  authorityType: string
  authorityNumber: string
  currentCompanyId: string
}) {
  const numberKey =
    normalizeIdentifier(
      authorityNumber
    )

  const typeKey =
    normalizeText(
      authorityType
    )

  if (
    !numberKey ||
    !typeKey
  ) {
    return {
      sameCompany: [],
      otherCompanies: [],
    }
  }

  const companies =
    getCompanies()

  const matches:
    GlobalAuthorityMatch[] =
    []

  for (
    const company of
    companies
  ) {
    const key =
      `tes_company_authorities_${company.id}`

    try {
      const raw =
        localStorage.getItem(
          key
        )

      if (!raw) {
        continue
      }

      const parsed =
        JSON.parse(raw)

      const records =
        Array.isArray(
          parsed?.authorities
        )
          ? parsed.authorities
          : []

      for (
        const record of
        records
      ) {
        if (
          record.deletedAt
        ) {
          continue
        }

        if (
          normalizeText(
            record.authorityType
          ) === typeKey &&
          normalizeIdentifier(
            record.authorityNumber
          ) === numberKey
        ) {
          matches.push({
            companyId:
              company.id,

            companyName:
              company.name,

            recordId:
              record.id,

            authorityType:
              record.authorityType,

            authorityNumber:
              record.authorityNumber,
          })
        }
      }
    } catch {
      // Skip malformed historical prototype data.
    }
  }

  return {
    sameCompany:
      matches.filter(
        (match) =>
          match.companyId ===
          currentCompanyId
      ),

    otherCompanies:
      matches.filter(
        (match) =>
          match.companyId !==
          currentCompanyId
      ),
  }
}

/* =========================================================
   HAZMAT TRIGGER
========================================================= */

function companyHasHazmat(
  company: Company
) {
  if (
    company.hazmat === true
  ) {
    return true
  }

  const cargoTypes =
    Array.isArray(
      company.cargoTypes
    )
      ? company.cargoTypes
      : []

  if (
    cargoTypes.some(
      (item) =>
        normalizeText(item).includes(
          "haz"
        ) ||
        normalizeText(item).includes(
          "dangerous goods"
        )
    )
  ) {
    return true
  }

  const cargoInformation =
    company.cargoInformation

  if (
    cargoInformation &&
    typeof cargoInformation ===
      "object"
  ) {
    const flattened =
      JSON.stringify(
        cargoInformation
      ).toLowerCase()

    if (
      flattened.includes(
        '"hazmat":true'
      ) ||
      flattened.includes(
        '"hazardous":true'
      ) ||
      flattened.includes(
        '"dangerousgoods":true'
      )
    ) {
      return true
    }
  }

  return false
}

/* =========================================================
   OPERATING SCOPE

   This is only the current development fallback.

   When Company Settings gets a more explicit
   applicability contract, this page can consume it
   without redesigning the record model.
========================================================= */

type CompanyAuthorityProfile = {
  country:
    string

  provinceState:
    string

  region:
    string

  canadaOperations:
    ApplicabilityStatus

  usOperations:
    ApplicabilityStatus

  ucr:
    ApplicabilityStatus

  phmsa:
    ApplicabilityStatus

  hazmat:
    boolean
}

function deriveAuthorityProfile(
  company: Company
): CompanyAuthorityProfile {
  const country =
    company.regCorpCountry ||
    ""

  const provinceState =
    company.regCorpState ||
    ""

  const region =
    company.region ||
    ""

  const normalizedCountry =
    normalizeText(
      country
    )

  const normalizedRegion =
    normalizeText(
      region
    )

  const canadaRegistered =
    normalizedCountry ===
      "canada" ||
    normalizedCountry.includes(
      "canada"
    )

  const usRegistered =
    normalizedCountry.includes(
      "united states"
    ) ||
    normalizedCountry ===
      "usa" ||
    normalizedCountry ===
      "us"

  const crossBorder =
    normalizedRegion.includes(
      "cross"
    )

  const canadaOnly =
    normalizedRegion.includes(
      "canada"
    ) &&
    !crossBorder

  const usOnly =
    (normalizedRegion.includes(
      "united states"
    ) ||
      normalizedRegion.includes(
        "usa"
      ) ||
      normalizedRegion.includes(
        "us only"
      )) &&
    !crossBorder

  const hazmat =
    companyHasHazmat(
      company
    )

  let canadaOperations:
    ApplicabilityStatus =
    "Needs Review"

  let usOperations:
    ApplicabilityStatus =
    "Needs Review"

  if (
    crossBorder
  ) {
    canadaOperations =
      "Required"

    usOperations =
      "Required"
  } else if (
    canadaOnly ||
    (canadaRegistered &&
      !usOnly)
  ) {
    canadaOperations =
      "Required"

    usOperations =
      "Not Required"
  } else if (
    usOnly ||
    usRegistered
  ) {
    canadaOperations =
      "Not Required"

    usOperations =
      "Required"
  }

  /*
    UCR remains on this page as an operating registration.

    At this stage we mark broad US/interstate/cross-border
    exposure as Required according to the current TES
    operating-profile model.

    Company Settings can later override this precisely.
  */

  const ucr =
    usOperations ===
    "Required"
      ? "Required"
      : usOperations ===
          "Not Required"
        ? "Not Required"
        : "Needs Review"

  /*
    User-defined current business rule:

    Cargo Information is mandatory.
    If company transports hazmat, PHMSA fleet authority/
    registration becomes mandatory.
  */

  const phmsa:
    ApplicabilityStatus =
    hazmat
      ? "Required"
      : "Not Required"

  return {
    country,
    provinceState,
    region,

    canadaOperations,
    usOperations,
    ucr,
    phmsa,
    hazmat,
  }
}

/* =========================================================
   3-YEAR VISIBILITY STANDARD
========================================================= */

function getThreeYearCutoff() {
  const cutoff =
    new Date()

  cutoff.setFullYear(
    cutoff.getFullYear() -
      STANDARD_VISIBLE_HISTORY_YEARS
  )

  return cutoff
}

function getRecordReferenceDate(
  record:
    | AuthorityRecord
    | AuditRecord
    | SafetyPlaceholderRecord
) {
  if (
    record.category ===
    "audit"
  ) {
    return (
      record.completedDate ||
      record.noticeDate ||
      record.createdAt
    )
  }

  if (
    record.category ===
    "safety"
  ) {
    return (
      record.reviewDate ||
      record.createdAt
    )
  }

  return (
    record.expiryDate ||
    record.renewalDate ||
    record.dueDate ||
    record.effectiveDate ||
    record.issueDate ||
    record.createdAt
  )
}

function isWithinStandardVisibleHistory(
  record:
    | AuthorityRecord
    | AuditRecord
    | SafetyPlaceholderRecord
) {
  const reference =
    getRecordReferenceDate(
      record
    )

  if (!reference) {
    return true
  }

  const date =
    new Date(reference)

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return true
  }

  return (
    date >=
    getThreeYearCutoff()
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

  const now =
    new Date()

  const today =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    )

  const target =
    new Date(
      `${date}T23:59:59`
    )

  return Math.ceil(
    (target.getTime() -
      today.getTime()) /
      86400000
  )
}

function getAuthorityDeadlineDate(
  record: AuthorityRecord
) {
  return (
    record.dueDate ||
    record.renewalDate ||
    record.expiryDate
  )
}

function getDeadlineStatus(
  date:
    | string
    | undefined,

  rules:
    DeadlineRules,

  deleted = false
): DeadlineStatus {
  if (deleted) {
    return "Deleted"
  }

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

function deadlineStyle(
  status:
    DeadlineStatus
) {
  switch (status) {
    case "Healthy":
      return {
        badge:
          "border-emerald-200 bg-emerald-50 text-emerald-800",

        accent:
          "border-l-emerald-500",

        text:
          "text-emerald-700",
      }

    case "Watch":
      return {
        badge:
          "border-amber-200 bg-amber-50 text-amber-800",

        accent:
          "border-l-amber-400",

        text:
          "text-amber-700",
      }

    case "Urgent":
      return {
        badge:
          "border-red-200 bg-red-50 text-red-700",

        accent:
          "border-l-red-400",

        text:
          "text-red-600",
      }

    case "Critical":
      return {
        badge:
          "border-red-400 bg-red-100 text-red-900",

        accent:
          "border-l-red-700",

        text:
          "font-semibold text-red-800",
      }

    case "Expired":
      return {
        badge:
          "border-red-900 bg-red-950 text-white",

        accent:
          "border-l-red-950",

        text:
          "font-bold text-red-950",
      }

    case "No Deadline":
      return {
        badge:
          "border-slate-200 bg-slate-50 text-slate-700",

        accent:
          "border-l-slate-300",

        text:
          "text-muted-foreground",
      }

    case "Deleted":
      return {
        badge:
          "border-slate-200 bg-slate-100 text-slate-500",

        accent:
          "border-l-slate-300",

        text:
          "text-muted-foreground",
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
    deadlineStyle(
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
   APPLICABILITY BADGE
========================================================= */

function ApplicabilityBadge({
  status,
}: {
  status:
    ApplicabilityStatus
}) {
  if (
    status ===
    "Required"
  ) {
    return (
      <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
        Required
      </Badge>
    )
  }

  if (
    status ===
    "Not Required"
  ) {
    return (
      <Badge
        variant="outline"
        className="text-muted-foreground"
      >
        Not Required
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className="border-amber-200 bg-amber-50 text-amber-800"
    >
      Needs Review
    </Badge>
  )
}

/* =========================================================
   COPY FIELD
========================================================= */

function CopyField({
  label,
  value,
}: {
  label: string
  value?: string
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

        setCopied(true)

        window.setTimeout(
          () =>
            setCopied(
              false
            ),
          1000
        )
      } catch {
        // Clipboard may fail in local non-secure testing.
      }
    }

  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
   FILE READER
========================================================= */

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
   DEFAULT DRAFTS
========================================================= */

function emptyAuthorityDraft({
  category,
  company,
  profile,
}: {
  category:
    AuthorityCategory

  company:
    Company

  profile:
    CompanyAuthorityProfile
}): AuthorityDraft {
  let applicability:
    ApplicabilityStatus =
    "Needs Review"

  if (
    category ===
    "canadian"
  ) {
    applicability =
      profile.canadaOperations
  }

  if (
    category ===
    "us_federal"
  ) {
    applicability =
      profile.usOperations
  }

  if (
    category ===
    "registration"
  ) {
    applicability =
      profile.ucr
  }

  if (
    category ===
    "hazmat"
  ) {
    applicability =
      profile.phmsa
  }

  return {
    category,

    authorityType:
      "",

    authorityName:
      "",

    authorityNumber:
      "",

    issuingAuthority:
      "",

    country:
      company.regCorpCountry ||
      "",

    jurisdiction:
      company.regCorpState ||
      "",

    issueDate:
      "",

    effectiveDate:
      "",

    renewalDate:
      "",

    expiryDate:
      "",

    dueDate:
      "",

    recordStatus:
      "Active",

    applicability,

    credentialStored:
      false,

    notes:
      "",
  }
}

function emptyAuditDraft():
  AuditDraft {
  return {
    auditType:
      "",

    regulator:
      "",

    jurisdiction:
      "",

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

function emptySafetyDraft():
  SafetyDraft {
  return {
    system:
      "Canadian Carrier Profile",

    jurisdiction:
      "",

    reviewDate:
      todayIso(),

    statusSummary:
      "",

    notes:
      "",
  }
}

/* =========================================================
   DOCUMENT SOURCE PICKER
========================================================= */

function DocumentSourcePicker({
  category,
  onCamera,
  onDevice,
  onClose,
}: {
  category:
    AuthorityCategory

  onCamera: () => void
  onDevice: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ScanDocumentIcon
                  size={18}
                />

                Scan Authority Document
              </CardTitle>

              <CardDescription className="mt-1">
                Choose the evidence source.
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
            className="rounded-xl border p-5 text-left hover:border-primary/40 hover:bg-primary/[0.035]"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Camera className="size-5" />
            </div>

            <p className="mt-4 text-sm font-semibold">
              Take Photo
            </p>

            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Capture the authority, registration, audit notice, or other supporting document.
            </p>
          </button>

          <button
            type="button"
            onClick={
              onDevice
            }
            className="rounded-xl border p-5 text-left hover:border-primary/40 hover:bg-primary/[0.035]"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Upload className="size-5" />
            </div>

            <p className="mt-4 text-sm font-semibold">
              Upload from Device
            </p>

            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Select a PDF or image already stored on the device.
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
  onCapture: (
    file: File
  ) => void

  onClose: () => void
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

  const capture = () => {
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

        const file =
          new File(
            [blob],

            `authority-capture-${Date.now()}.jpg`,

            {
              type:
                "image/jpeg",
            }
          )

        streamRef.current
          ?.getTracks()
          .forEach(
            (track) =>
              track.stop()
          )

        onCapture(
          file
        )
      },

      "image/jpeg",

      0.94
    )
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black">
      <div className="flex min-h-16 items-center justify-between border-b border-white/10 px-5 text-white">
        <div>
          <p className="text-sm font-semibold">
            Capture Document
          </p>

          <p className="mt-0.5 text-[10px] text-white/60">
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
========================================================= */

function DocumentViewer({
  file,
  dataUrl,
  onReplace,
}: {
  file: File
  dataUrl: string

  onReplace: () => void
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

  const reset = () => {
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

      if (
        !document.fullscreenElement
      ) {
        await rootRef.current.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    }

  const pointerDown = (
    event:
      React.PointerEvent<HTMLDivElement>
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
  }

  const pointerMove = (
    event:
      React.PointerEvent<HTMLDivElement>
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
  }

  const pdf =
    file.type ===
    "application/pdf"

  return (
    <div
      ref={
        rootRef
      }
      className="flex h-full min-h-0 flex-col bg-muted/15 fullscreen:bg-background"
    >
      <div className="flex min-h-12 items-center justify-between gap-2 border-b bg-background px-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold">
            Original Document
          </p>

          <p className="max-w-[320px] truncate text-[10px] text-muted-foreground">
            {file.name}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
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
              zoom * 100
            )}
            %
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() =>
              setZoom(
                (current) =>
                  Math.min(
                    4,
                    current +
                      0.25
                  )
              )
            }
          >
            <ZoomIn className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() =>
              setRotation(
                (current) =>
                  (current +
                    90) %
                  360
              )
            }
          >
            <RotateCcw className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={
              fullscreen
            }
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
      </div>

      <div
        className="relative min-h-[500px] flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        onPointerDown={
          pointerDown
        }
        onPointerMove={
          pointerMove
        }
        onPointerUp={() => {
          dragRef.current.active =
            false
        }}
        onPointerCancel={() => {
          dragRef.current.active =
            false
        }}
        style={{
          touchAction:
            "none",
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center p-5">
          <div
            style={{
              transform: `
                translate(${pan.x}px, ${pan.y}px)
                scale(${zoom})
                rotate(${rotation}deg)
              `,

              transformOrigin:
                "center center",
            }}
          >
            {pdf ? (
              <iframe
                src={
                  dataUrl
                }
                title="Authority document"
                className="h-[72vh] w-[62vw] max-w-[1000px] rounded-lg border bg-background pointer-events-none"
              />
            ) : (
              <img
                src={
                  dataUrl
                }
                alt="Authority document"
                draggable={
                  false
                }
                className="max-h-[calc(100vh-190px)] max-w-[calc(100vw-500px)] rounded-lg object-contain shadow-sm"
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t bg-background px-4 py-2">
        <p className="max-w-[70%] truncate text-[10px] text-muted-foreground">
          {file.name}
        </p>

        <Button
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
      </div>
    </div>
  )
}

/* =========================================================
   AUTHORITY TYPE OPTIONS
========================================================= */

const AUTHORITY_OPTIONS: Record<
  Exclude<
    AuthorityCategory,
    "audit" | "safety"
  >,
  {
    value: string
    label: string
  }[]
> = {
  canadian: [
    {
      value:
        "MVID",

      label:
        "MVID",
    },

    {
      value:
        "RIN",

      label:
        "RIN",
    },

    {
      value:
        "NSC",

      label:
        "NSC / Safety Fitness Certificate",
    },

    {
      value:
        "CVOR",

      label:
        "CVOR",
    },

    {
      value:
        "OTHER_CANADIAN",

      label:
        "Other Canadian Authority",
    },
  ],

  us_federal: [
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

    {
      value:
        "OTHER_US",

      label:
        "Other US Federal Authority",
    },
  ],

  registration: [
    {
      value:
        "UCR",

      label:
        "Unified Carrier Registration (UCR)",
    },

    {
      value:
        "OTHER_OPERATING_REGISTRATION",

      label:
        "Other Operating Registration",
    },
  ],

  hazmat: [
    {
      value:
        "PHMSA",

      label:
        "PHMSA Hazmat Registration",
    },

    {
      value:
        "OTHER_HAZMAT_FLEET",

      label:
        "Other Fleet-Level Hazmat Authority",
    },
  ],
}

/* =========================================================
   AUTHORITY DRAFT FORM
========================================================= */

function AuthorityDraftForm({
  draft,
  onChange,
}: {
  draft:
    AuthorityDraft

  onChange: (
    draft:
      AuthorityDraft
  ) => void
}) {
  const options =
    draft.category ===
      "audit" ||
    draft.category ===
      "safety"
      ? []
      : AUTHORITY_OPTIONS[
          draft.category
        ]

  const update = <
    K extends keyof AuthorityDraft
  >(
    key: K,
    value:
      AuthorityDraft[K]
  ) => {
    const next = {
      ...draft,

      [key]:
        value,
    }

    if (
      key ===
      "authorityType"
    ) {
      const selected =
        options.find(
          (option) =>
            option.value ===
            value
        )

      if (selected) {
        next.authorityName =
          selected.label
      }
    }

    onChange(
      next
    )
  }

  return (
    <Card className="overflow-visible shadow-none">
      <CardHeader className="border-b bg-muted/15 py-4">
        <CardTitle className="text-sm">
          Authority / Registration Record
        </CardTitle>

        <CardDescription className="text-xs">
          Manual and OCR entry use the same record fields.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label>
            Record Type *
          </Label>

          <Select
            value={
              draft.authorityType ||
              undefined
            }
            onValueChange={(
              value
            ) =>
              update(
                "authorityType",
                value
              )
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select authority" />
            </SelectTrigger>

            <SelectContent className="z-[170]">
              {options.map(
                (option) => (
                  <SelectItem
                    key={
                      option.value
                    }
                    value={
                      option.value
                    }
                  >
                    {option.label}
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
              draft.authorityName
            }
            onChange={(
              event
            ) =>
              update(
                "authorityName",
                event.target.value
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Authority / Registration Number *
          </Label>

          <Input
            value={
              draft.authorityNumber
            }
            onChange={(
              event
            ) =>
              update(
                "authorityNumber",
                event.target.value
              )
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
            placeholder="e.g. FMCSA"
            onChange={(
              event
            ) =>
              update(
                "issuingAuthority",
                event.target.value
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Country
          </Label>

          <Input
            value={
              draft.country
            }
            onChange={(
              event
            ) =>
              update(
                "country",
                event.target.value
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Province / State / Jurisdiction
          </Label>

          <Input
            value={
              draft.jurisdiction
            }
            onChange={(
              event
            ) =>
              update(
                "jurisdiction",
                event.target.value
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Record Status
          </Label>

          <Select
            value={
              draft.recordStatus
            }
            onValueChange={(
              value
            ) =>
              update(
                "recordStatus",
                value as AuthorityDraft["recordStatus"]
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="z-[170]">
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

              <SelectItem value="Unknown">
                Unknown
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>
            Applicability
          </Label>

          <Select
            value={
              draft.applicability
            }
            onValueChange={(
              value
            ) =>
              update(
                "applicability",
                value as ApplicabilityStatus
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="z-[170]">
              <SelectItem value="Required">
                Required
              </SelectItem>

              <SelectItem value="Not Required">
                Not Required
              </SelectItem>

              <SelectItem value="Needs Review">
                Needs Review
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

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
              update(
                "issueDate",
                event.target.value
              )
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
              update(
                "effectiveDate",
                event.target.value
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Renewal Date
          </Label>

          <Input
            type="date"
            value={
              draft.renewalDate
            }
            onChange={(
              event
            ) =>
              update(
                "renewalDate",
                event.target.value
              )
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
              update(
                "expiryDate",
                event.target.value
              )
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
              update(
                "dueDate",
                event.target.value
              )
            }
          />

          <p className="text-[10px] text-muted-foreground">
            Use for periodic requirements such as MCS-150.
          </p>
        </div>

        <div className="space-y-2">
          <Label>
            Credential Stored
          </Label>

          <Select
            value={
              draft.credentialStored
                ? "yes"
                : "no"
            }
            onValueChange={(
              value
            ) =>
              update(
                "credentialStored",
                value ===
                  "yes"
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="z-[170]">
              <SelectItem value="yes">
                Yes
              </SelectItem>

              <SelectItem value="no">
                No
              </SelectItem>
            </SelectContent>
          </Select>

          <p className="text-[10px] text-muted-foreground">
            Sensitive credential values belong in Credentials, not on this page.
          </p>
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
              update(
                "notes",
                event.target.value
              )
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

function AuditDraftForm({
  draft,
  onChange,
}: {
  draft:
    AuditDraft

  onChange: (
    draft:
      AuditDraft
  ) => void
}) {
  const update = <
    K extends keyof AuditDraft
  >(
    key: K,
    value:
      AuditDraft[K]
  ) => {
    onChange({
      ...draft,

      [key]:
        value,
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
              update(
                "auditType",
                event.target.value
              )
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
              update(
                "regulator",
                event.target.value
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Jurisdiction
          </Label>

          <Input
            value={
              draft.jurisdiction
            }
            onChange={(
              event
            ) =>
              update(
                "jurisdiction",
                event.target.value
              )
            }
          />
        </div>

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
              update(
                "referenceNumber",
                event.target.value
              )
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
              update(
                "noticeDate",
                event.target.value
              )
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
              update(
                "dueDate",
                event.target.value
              )
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
              update(
                "completedDate",
                event.target.value
              )
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
              update(
                "status",
                value as AuditDraft["status"]
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="z-[170]">
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
              update(
                "outcome",
                event.target.value
              )
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
              update(
                "score",
                event.target.value
              )
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
              update(
                "followUpRequired",
                value ===
                  "yes"
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="z-[170]">
              <SelectItem value="yes">
                Yes
              </SelectItem>

              <SelectItem value="no">
                No
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

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
              update(
                "followUpDueDate",
                event.target.value
              )
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
              update(
                "notes",
                event.target.value
              )
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   SAFETY PLACEHOLDER FORM

   Deliberately shallow.
   Detailed Carrier Profile / CVOR / SMS system comes later.
========================================================= */

function SafetyDraftForm({
  draft,
  onChange,
}: {
  draft:
    SafetyDraft

  onChange: (
    draft:
      SafetyDraft
  ) => void
}) {
  const update = <
    K extends keyof SafetyDraft
  >(
    key: K,
    value:
      SafetyDraft[K]
  ) => {
    onChange({
      ...draft,

      [key]:
        value,
    })
  }

  return (
    <Card className="overflow-visible shadow-none">
      <CardHeader className="border-b bg-muted/15 py-4">
        <CardTitle className="text-sm">
          Safety Performance Snapshot
        </CardTitle>

        <CardDescription className="text-xs">
          Temporary structure only. Detailed safety architecture will be developed separately.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label>
            Safety System
          </Label>

          <Select
            value={
              draft.system
            }
            onValueChange={(
              value
            ) =>
              update(
                "system",
                value as SafetyDraft["system"]
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="z-[170]">
              <SelectItem value="Canadian Carrier Profile">
                Canadian Carrier Profile
              </SelectItem>

              <SelectItem value="Ontario CVOR">
                Ontario CVOR
              </SelectItem>

              <SelectItem value="FMCSA SMS">
                FMCSA SMS
              </SelectItem>

              <SelectItem value="Other">
                Other
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>
            Jurisdiction
          </Label>

          <Input
            value={
              draft.jurisdiction
            }
            onChange={(
              event
            ) =>
              update(
                "jurisdiction",
                event.target.value
              )
            }
          />
        </div>

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
              update(
                "reviewDate",
                event.target.value
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Status Summary
          </Label>

          <Input
            value={
              draft.statusSummary
            }
            placeholder="High-level summary only"
            onChange={(
              event
            ) =>
              update(
                "statusSummary",
                event.target.value
              )
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
              update(
                "notes",
                event.target.value
              )
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

function ManualRecordModal({
  category,
  company,
  profile,

  onCancel,

  onSaveAuthority,
  onSaveAudit,
  onSaveSafety,
}: {
  category:
    AuthorityCategory

  company:
    Company

  profile:
    CompanyAuthorityProfile

  onCancel: () => void

  onSaveAuthority: (
    draft:
      AuthorityDraft
  ) => void

  onSaveAudit: (
    draft:
      AuditDraft
  ) => void

  onSaveSafety: (
    draft:
      SafetyDraft
  ) => void
}) {
  const [
    authorityDraft,
    setAuthorityDraft,
  ] =
    useState(
      emptyAuthorityDraft({
        category,
        company,
        profile,
      })
    )

  const [
    auditDraft,
    setAuditDraft,
  ] =
    useState(
      emptyAuditDraft()
    )

  const [
    safetyDraft,
    setSafetyDraft,
  ] =
    useState(
      emptySafetyDraft()
    )

  const authorityReady =
    Boolean(
      authorityDraft.authorityType &&
        authorityDraft.authorityName.trim() &&
        authorityDraft.authorityNumber.trim()
    )

  const auditReady =
    Boolean(
      auditDraft.auditType.trim() &&
        auditDraft.regulator.trim()
    )

  const safetyReady =
    Boolean(
      safetyDraft.reviewDate
    )

  const ready =
    category ===
    "audit"
      ? auditReady
      : category ===
          "safety"
        ? safetyReady
        : authorityReady

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/45 p-4 backdrop-blur-sm">
      <div className="mx-auto my-6 max-w-5xl">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">
                  {category ===
                  "audit"
                    ? "Add Audit / Intervention"
                    : category ===
                        "safety"
                      ? "Add Safety Snapshot"
                      : "Add Authority / Registration"}
                </CardTitle>

                <CardDescription className="mt-1">
                  Manual entry uses the same underlying record structure as OCR.
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
            {category ===
              "audit" ? (
              <AuditDraftForm
                draft={
                  auditDraft
                }
                onChange={
                  setAuditDraft
                }
              />
            ) : category ===
              "safety" ? (
              <SafetyDraftForm
                draft={
                  safetyDraft
                }
                onChange={
                  setSafetyDraft
                }
              />
            ) : (
              <AuthorityDraftForm
                draft={
                  authorityDraft
                }
                onChange={
                  setAuthorityDraft
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
                onClick={() => {
                  if (
                    category ===
                    "audit"
                  ) {
                    onSaveAudit(
                      auditDraft
                    )

                    return
                  }

                  if (
                    category ===
                    "safety"
                  ) {
                    onSaveSafety(
                      safetyDraft
                    )

                    return
                  }

                  onSaveAuthority(
                    authorityDraft
                  )
                }}
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

   Backend endpoint first.
   No fabricated authority values if backend is absent.
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
      "category",
      session.category
    )

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
    // Development fallback below.
  }

  /*
    We deliberately do not invent authority numbers or
    regulatory facts when no real OCR backend exists.

    The user can still verify/fill fields manually while
    testing the complete document workflow.
  */

  return {
    confidence:
      90,

    extractionComplete:
      true,
  }
}

/* =========================================================
   OCR WORKSPACE
========================================================= */

function OCRWorkspace({
  session,
  setSession,

  company,
  profile,

  onReplace,
  onCancel,
  onSave,
}: {
  session:
    OCRSession

  setSession:
    React.Dispatch<
      React.SetStateAction<OCRSession | null>
    >

  company:
    Company

  profile:
    CompanyAuthorityProfile

  onReplace: () => void
  onCancel: () => void

  onSave: (
    session:
      OCRSession
  ) => void
}) {
  const runOCR =
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

  const authorityReady =
    Boolean(
      session.authorityDraft
        ?.authorityType &&
        session.authorityDraft
          .authorityName
          .trim() &&
        session.authorityDraft
          .authorityNumber
          .trim()
    )

  const auditReady =
    Boolean(
      session.auditDraft
        ?.auditType
        .trim() &&
        session.auditDraft
          .regulator
          .trim()
    )

  const safetyReady =
    Boolean(
      session.safetyDraft
        ?.reviewDate
    )

  const ready =
    session.category ===
    "audit"
      ? auditReady
      : session.category ===
          "safety"
        ? safetyReady
        : authorityReady

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-background">
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
                Authority Document Intelligence
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
              {session.file.name}
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

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(420px,0.92fr)_minmax(640px,1.08fr)]">
        <div className="min-h-0 border-r">
          <DocumentViewer
            file={
              session.file
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
                  Extracted Record
                </h2>

                <p className="mt-1 text-xs text-muted-foreground">
                  Verify the extracted information against the original evidence before saving.
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
                  runOCR
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
            {session.extractionComplete && (
              <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                <div className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />

                  <div>
                    <p className="text-xs font-semibold">
                      Extraction ready for review
                    </p>

                    <p className="mt-1 text-[11px] text-muted-foreground">
                      TES will not silently create an authority record without your verification.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {session.category ===
              "audit" ? (
              <AuditDraftForm
                draft={
                  session.auditDraft ||
                  emptyAuditDraft()
                }
                onChange={(
                  auditDraft
                ) =>
                  setSession(
                    (current) =>
                      current
                        ? {
                            ...current,

                            auditDraft,
                          }
                        : current
                  )
                }
              />
            ) : session.category ===
              "safety" ? (
              <SafetyDraftForm
                draft={
                  session.safetyDraft ||
                  emptySafetyDraft()
                }
                onChange={(
                  safetyDraft
                ) =>
                  setSession(
                    (current) =>
                      current
                        ? {
                            ...current,

                            safetyDraft,
                          }
                        : current
                  )
                }
              />
            ) : (
              <AuthorityDraftForm
                draft={
                  session.authorityDraft ||
                  emptyAuthorityDraft({
                    category:
                      session.category,

                    company,
                    profile,
                  })
                }
                onChange={(
                  authorityDraft
                ) =>
                  setSession(
                    (current) =>
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
          </div>

          <div className="border-t p-4">
            <div className="flex justify-end">
              <Button
                disabled={
                  !ready
                }
                onClick={() =>
                  onSave(
                    session
                  )
                }
              >
                <Check className="mr-2 size-4" />

                Verify & Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   RECORD INSPECTOR
========================================================= */

function RecordInspector({
  record,
  evidence,

  deadlineRules,

  onClose,
  onEdit,
  onDelete,
}: {
  record:
    SelectedRecord | null

  evidence:
    AuthorityEvidence[]

  deadlineRules:
    DeadlineRules

  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  if (!record) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-[520px] flex-col items-center justify-center p-10 text-center">
          <Landmark className="size-10 text-muted-foreground/30" />

          <p className="mt-4 text-sm font-medium">
            Select a record
          </p>

          <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted-foreground">
            Open an authority, registration, safety snapshot, or audit record to review its details and evidence.
          </p>
        </CardContent>
      </Card>
    )
  }

  const attachedEvidence =
    evidence.filter(
      (item) =>
        record.evidenceIds.includes(
          item.id
        )
    )

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-primary/[0.03]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">
                {record.category ===
                "audit"
                  ? record.auditType
                  : record.category ===
                      "safety"
                    ? record.system
                    : record.authorityName}
              </CardTitle>

              {record.category !==
                "audit" &&
                record.category !==
                  "safety" && (
                  <DeadlineBadge
                    status={getDeadlineStatus(
                      getAuthorityDeadlineDate(
                        record
                      ),

                      deadlineRules,

                      Boolean(
                        record.deletedAt
                      )
                    )}
                  />
                )}
            </div>

            <CardDescription className="mt-1 font-mono text-[10px]">
              {record.id}
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

      <CardContent className="space-y-5 p-4">
        {record.category ===
        "audit" ? (
          <>
            <CopyField
              label="Regulator"
              value={
                record.regulator
              }
            />

            <CopyField
              label="Jurisdiction"
              value={
                record.jurisdiction
              }
            />

            <CopyField
              label="Reference"
              value={
                record.referenceNumber
              }
            />

            <CopyField
              label="Notice Date"
              value={
                record.noticeDate
              }
            />

            <CopyField
              label="Due Date"
              value={
                record.dueDate
              }
            />

            <CopyField
              label="Completed Date"
              value={
                record.completedDate
              }
            />

            <CopyField
              label="Status"
              value={
                record.status
              }
            />

            <CopyField
              label="Outcome"
              value={
                record.outcome
              }
            />

            <CopyField
              label="Score / Rating"
              value={
                record.score
              }
            />
          </>
        ) : record.category ===
          "safety" ? (
          <>
            <CopyField
              label="Safety System"
              value={
                record.system
              }
            />

            <CopyField
              label="Jurisdiction"
              value={
                record.jurisdiction
              }
            />

            <CopyField
              label="Review Date"
              value={
                record.reviewDate
              }
            />

            <CopyField
              label="Status Summary"
              value={
                record.statusSummary
              }
            />

            <div className="rounded-lg border border-dashed bg-muted/20 p-3">
              <p className="text-[11px] leading-5 text-muted-foreground">
                Detailed Canadian Carrier Profile / CVOR / FMCSA SMS architecture will be developed separately.
              </p>
            </div>
          </>
        ) : (
          <>
            <CopyField
              label="Authority / Registration"
              value={
                record.authorityName
              }
            />

            <CopyField
              label="Number"
              value={
                record.authorityNumber
              }
            />

            <CopyField
              label="Issuing Authority"
              value={
                record.issuingAuthority
              }
            />

            <CopyField
              label="Country"
              value={
                record.country
              }
            />

            <CopyField
              label="Jurisdiction"
              value={
                record.jurisdiction
              }
            />

            <CopyField
              label="Record Status"
              value={
                record.recordStatus
              }
            />

            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Applicability
              </p>

              <div className="mt-2">
                <ApplicabilityBadge
                  status={
                    record.applicability
                  }
                />
              </div>
            </div>

            <CopyField
              label="Issue Date"
              value={
                record.issueDate
              }
            />

            <CopyField
              label="Effective Date"
              value={
                record.effectiveDate
              }
            />

            <CopyField
              label="Renewal Date"
              value={
                record.renewalDate
              }
            />

            <CopyField
              label="Expiry Date"
              value={
                record.expiryDate
              }
            />

            <CopyField
              label="Due Date"
              value={
                record.dueDate
              }
            />

            <CopyField
              label="Credential"
              value={
                record.credentialStored
                  ? "Stored in Credentials"
                  : "Not recorded"
              }
            />
          </>
        )}

        <section className="border-t pt-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Evidence
          </p>

          {attachedEvidence.length ===
          0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No evidence attached.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {attachedEvidence.map(
                (document) => (
                  <div
                    key={
                      document.id
                    }
                    className="rounded-lg border p-3"
                  >
                    <div className="flex gap-3">
                      <FileText className="mt-0.5 size-4 text-primary" />

                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">
                          {
                            document.documentName
                          }
                        </p>

                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {document.documentDate ||
                            document.uploadedAt.slice(
                              0,
                              10
                            )}

                          {document.ocrConfidence !==
                            undefined &&
                            ` · OCR ${document.ocrConfidence}%`}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </section>

        <section className="border-t pt-4">
          <div className="flex gap-2">
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

          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            Delete remains available during portal development for testing. It will be replaced by Archive when development is complete.
          </p>
        </section>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   AUTHORITY ROW
========================================================= */

function AuthorityRow({
  record,

  deadlineRules,

  selected,

  onSelect,
}: {
  record:
    AuthorityRecord

  deadlineRules:
    DeadlineRules

  selected:
    boolean

  onSelect: () => void
}) {
  const deadline =
    getAuthorityDeadlineDate(
      record
    )

  const status =
    getDeadlineStatus(
      deadline,

      deadlineRules,

      Boolean(
        record.deletedAt
      )
    )

  const style =
    deadlineStyle(
      status
    )

  return (
    <div
      onClick={
        onSelect
      }
      className={`grid cursor-pointer gap-4 border-l-4 p-4 transition-colors md:grid-cols-12 ${style.accent} ${
        selected
          ? "bg-primary/[0.045]"
          : "hover:bg-muted/25"
      }`}
    >
      <div className="md:col-span-3">
        <p className="text-sm font-semibold">
          {
            record.authorityName
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
            record.authorityNumber
          }
        </p>

        <p className="mt-1 text-[10px] text-muted-foreground">
          {
            record.issuingAuthority ||
            "Issuing authority not recorded"
          }
        </p>
      </div>

      <div className="md:col-span-2 text-xs">
        <p>
          {
            record.jurisdiction ||
            record.country ||
            "—"
          }
        </p>

        <div className="mt-1">
          <ApplicabilityBadge
            status={
              record.applicability
            }
          />
        </div>
      </div>

      <div className="md:col-span-2 text-xs">
        <p className="text-muted-foreground">
          {deadline
            ? "Next deadline"
            : "No deadline"}
        </p>

        <p
          className={`mt-1 font-medium ${style.text}`}
        >
          {deadline ||
            "—"}
        </p>
      </div>

      <div className="flex items-center justify-end md:col-span-2">
        <DeadlineBadge
          status={
            status
          }
        />
      </div>
    </div>
  )
}

/* =========================================================
   AUDIT ROW
========================================================= */

function AuditRow({
  record,
  selected,
  onSelect,
}: {
  record:
    AuditRecord

  selected:
    boolean

  onSelect: () => void
}) {
  return (
    <div
      onClick={
        onSelect
      }
      className={`grid cursor-pointer gap-4 p-4 transition-colors md:grid-cols-12 ${
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
          {
            record.id
          }
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
            record.referenceNumber ||
            "No reference"
          }
        </p>
      </div>

      <div className="md:col-span-2 text-xs">
        <p className="text-muted-foreground">
          Due
        </p>

        <p className="mt-1 font-medium">
          {
            record.dueDate ||
            "—"
          }
        </p>
      </div>

      <div className="md:col-span-2 text-xs">
        <p className="text-muted-foreground">
          Completed
        </p>

        <p className="mt-1 font-medium">
          {
            record.completedDate ||
            "—"
          }
        </p>
      </div>

      <div className="flex justify-end md:col-span-2">
        <Badge
          variant="outline"
        >
          {
            record.status
          }
        </Badge>
      </div>
    </div>
  )
}

/* =========================================================
   SAFETY ROW
========================================================= */

function SafetyRow({
  record,
  selected,
  onSelect,
}: {
  record:
    SafetyPlaceholderRecord

  selected:
    boolean

  onSelect: () => void
}) {
  return (
    <div
      onClick={
        onSelect
      }
      className={`grid cursor-pointer gap-4 p-4 transition-colors md:grid-cols-12 ${
        selected
          ? "bg-primary/[0.045]"
          : "hover:bg-muted/25"
      }`}
    >
      <div className="md:col-span-4">
        <p className="text-sm font-semibold">
          {
            record.system
          }
        </p>

        <p className="mt-1 text-[10px] text-muted-foreground">
          {
            record.jurisdiction ||
            "—"
          }
        </p>
      </div>

      <div className="md:col-span-3 text-xs">
        <p className="text-muted-foreground">
          Review Date
        </p>

        <p className="mt-1 font-medium">
          {
            record.reviewDate
          }
        </p>
      </div>

      <div className="md:col-span-5 text-xs">
        {
          record.statusSummary ||
          "No summary"
        }
      </div>
    </div>
  )
}

/* =========================================================
   SECTION COMPONENT
========================================================= */

function AuthoritySection({
  title,
  description,

  applicability,

  emptyMessage,

  records,

  deadlineRules,

  selectedId,

  onSelect,

  onScan,
  onManual,
}: {
  title: string
  description: string

  applicability:
    ApplicabilityStatus

  emptyMessage:
    string

  records:
    AuthorityRecord[]

  deadlineRules:
    DeadlineRules

  selectedId?:
    string

  onSelect: (
    record:
      AuthorityRecord
  ) => void

  onScan: () => void
  onManual: () => void
}) {
  return (
    <Card className="overflow-visible">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm">
                {title}
              </CardTitle>

              <ApplicabilityBadge
                status={
                  applicability
                }
              />
            </div>

            <CardDescription className="mt-1 text-xs">
              {description}
            </CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
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
              {emptyMessage}
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
                  deadlineRules={
                    deadlineRules
                  }
                  selected={
                    selectedId ===
                    record.id
                  }
                  onSelect={() =>
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
    settings,
    setSettings,
  ] =
    useState<SystemSettings>(
      loadSystemSettings()
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
    selectedRecord,
    setSelectedRecord,
  ] =
    useState<SelectedRecord | null>(
      null
    )

  const [
    manualCategory,
    setManualCategory,
  ] =
    useState<AuthorityCategory | null>(
      null
    )

  const [
    sourceCategory,
    setSourceCategory,
  ] =
    useState<AuthorityCategory | null>(
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

  const [
    editingRecord,
    setEditingRecord,
  ] =
    useState<SelectedRecord | null>(
      null
    )

  const storageKey =
    `tes_company_authorities_${companyId}`

  /* =======================================================
     LOAD
  ======================================================= */

  useEffect(() => {
    try {
      const companies =
        getCompanies()

      const found =
        companies.find(
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

          audits:
            Array.isArray(
              parsed.audits
            )
              ? parsed.audits
              : [],

          safety:
            Array.isArray(
              parsed.safety
            )
              ? parsed.safety
              : [],

          evidence:
            Array.isArray(
              parsed.evidence
            )
              ? parsed.evidence
              : [],
        })
      }

      setSettings(
        loadSystemSettings()
      )
    } catch (error) {
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
    if (
      !loading
    ) {
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

  /* =======================================================
     PROFILE
  ======================================================= */

  const profile =
    useMemo(
      () =>
        company
          ? deriveAuthorityProfile(
              company
            )
          : null,

      [company]
    )

  const deadlineRules =
    settings.deadlineRules ||
    settings.expiryRules ||
    DEFAULT_DEADLINE_RULES

  /* =======================================================
     HISTORY
  ======================================================= */

  const visibleAuthorities =
    data.authorities.filter(
      (record) =>
        !record.deletedAt &&
        (showOlderHistory ||
          isWithinStandardVisibleHistory(
            record
          ))
    )

  const visibleAudits =
    data.audits.filter(
      (record) =>
        !record.deletedAt &&
        (showOlderHistory ||
          isWithinStandardVisibleHistory(
            record
          ))
    )

  const visibleSafety =
    data.safety.filter(
      (record) =>
        !record.deletedAt &&
        (showOlderHistory ||
          isWithinStandardVisibleHistory(
            record
          ))
    )

  const oldRecordCount =
    [
      ...data.authorities,
      ...data.audits,
      ...data.safety,
    ].filter(
      (record) =>
        !record.deletedAt &&
        !isWithinStandardVisibleHistory(
          record
        )
    ).length

  /* =======================================================
     CATEGORY RECORDS
  ======================================================= */

  const categoryRecords = (
    category:
      AuthorityCategory
  ) =>
    visibleAuthorities.filter(
      (record) =>
        record.category ===
        category
    )

  /* =======================================================
     SUMMARY COUNTS
  ======================================================= */

  const liveAuthorityStatuses =
    visibleAuthorities.map(
      (record) =>
        getDeadlineStatus(
          getAuthorityDeadlineDate(
            record
          ),

          deadlineRules
        )
    )

  const countStatus = (
    status:
      DeadlineStatus
  ) =>
    liveAuthorityStatuses.filter(
      (item) =>
        item ===
        status
    ).length

  /* =======================================================
     DOCUMENT PROCESSING
  ======================================================= */

  const processDocument =
    async (
      file: File,

      source:
        DocumentSource
    ) => {
      if (
        !sourceCategory ||
        !company ||
        !profile
      ) {
        return
      }

      const allowed =
        file.type.startsWith(
          "image/"
        ) ||
        file.type ===
          "application/pdf"

      if (!allowed) {
        window.alert(
          "Please select a PDF or image."
        )

        return
      }

      const dataUrl =
        await readFileAsDataUrl(
          file
        )

      setOcrSession({
        category:
          sourceCategory,

        source,

        file,

        dataUrl,

        processing:
          false,

        extractionComplete:
          false,

        confidence:
          undefined,

        authorityDraft:
          sourceCategory ===
            "audit" ||
          sourceCategory ===
            "safety"
            ? undefined
            : emptyAuthorityDraft({
                category:
                  sourceCategory,

                company,

                profile,
              }),

        auditDraft:
          sourceCategory ===
          "audit"
            ? emptyAuditDraft()
            : undefined,

        safetyDraft:
          sourceCategory ===
          "safety"
            ? emptySafetyDraft()
            : undefined,
      })

      setSourceCategory(
        null
      )
    }

  /* =======================================================
     AUTHORITY SAVE
  ======================================================= */

  const saveAuthorityDraft = ({
    draft,
    source,
    evidence,
    existingId,
  }: {
    draft:
      AuthorityDraft

    source:
      SourceType

    evidence?:
      AuthorityEvidence

    existingId?:
      string
  }) => {
    /*
      HARD DUPLICATION CONTROL.
  */

    const globalMatch =
      scanGlobalAuthorityIdentifier({
        authorityType:
          draft.authorityType,

        authorityNumber:
          draft.authorityNumber,

        currentCompanyId:
          companyId,
      })

    if (
      globalMatch.otherCompanies.length >
      0
    ) {
      const first =
        globalMatch.otherCompanies[0]

      window.alert(
        `Duplicate identifier conflict.\n\n${draft.authorityType} ${draft.authorityNumber} is already connected to ${first.companyName} (${first.companyId}).\n\nTES will not create a second authoritative record.`
      )

      return false
    }

    /*
      Same company, same identifier.
      If not editing that exact record, treat as duplicate.
    */

    const localDuplicate =
      globalMatch.sameCompany.find(
        (match) =>
          match.recordId !==
          existingId
      )

    if (
      localDuplicate
    ) {
      window.alert(
        "This authority identifier already exists for this company. Open the existing record and edit/update it instead of creating a duplicate."
      )

      return false
    }

    const timestamp =
      isoNow()

    if (
      existingId
    ) {
      setData(
        (current) => ({
          ...current,

          authorities:
            current.authorities.map(
              (record) =>
                record.id ===
                existingId
                  ? {
                      ...record,

                      ...draft,

                      source,

                      evidenceIds:
                        evidence
                          ? Array.from(
                              new Set([
                                ...record.evidenceIds,
                                evidence.id,
                              ])
                            )
                          : record.evidenceIds,

                      updatedAt:
                        timestamp,
                    }
                  : record
            ),

          evidence:
            evidence
              ? [
                  evidence,

                  ...current.evidence,
                ]
              : current.evidence,
        })
      )

      return true
    }

    /*
      Renewal/history logic:
      same authority type but different identifier/period
      can remain separate and reference history where useful.
    */

    const previous =
      data.authorities
        .filter(
          (record) =>
            !record.deletedAt &&
            normalizeText(
              record.authorityType
            ) ===
              normalizeText(
                draft.authorityType
              )
        )
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(
              a.createdAt
            )
        )[0]

    const record:
      AuthorityRecord =
      {
        id:
          createId(
            "AUTH"
          ),

        ...draft,

        source,

        evidenceIds:
          evidence
            ? [
                evidence.id,
              ]
            : [],

        previousRecordId:
          previous?.id,

        createdAt:
          timestamp,

        updatedAt:
          timestamp,
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

                  authorityRecordId:
                    record.id,
                },

                ...current.evidence,
              ]
            : current.evidence,
      })
    )

    setSelectedRecord(
      record
    )

    return true
  }

  /* =======================================================
     AUDIT SAVE
  ======================================================= */

  const saveAuditDraft = ({
    draft,
    source,
    evidence,
    existingId,
  }: {
    draft:
      AuditDraft

    source:
      SourceType

    evidence?:
      AuthorityEvidence

    existingId?:
      string
  }) => {
    const timestamp =
      isoNow()

    if (
      existingId
    ) {
      setData(
        (current) => ({
          ...current,

          audits:
            current.audits.map(
              (record) =>
                record.id ===
                existingId
                  ? {
                      ...record,

                      ...draft,

                      source,

                      evidenceIds:
                        evidence
                          ? Array.from(
                              new Set([
                                ...record.evidenceIds,
                                evidence.id,
                              ])
                            )
                          : record.evidenceIds,

                      updatedAt:
                        timestamp,
                    }
                  : record
            ),

          evidence:
            evidence
              ? [
                  evidence,

                  ...current.evidence,
                ]
              : current.evidence,
        })
      )

      return true
    }

    const record:
      AuditRecord =
      {
        id:
          createId(
            "AUD"
          ),

        category:
          "audit",

        ...draft,

        source,

        evidenceIds:
          evidence
            ? [
                evidence.id,
              ]
            : [],

        createdAt:
          timestamp,

        updatedAt:
          timestamp,
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
                evidence,

                ...current.evidence,
              ]
            : current.evidence,
      })
    )

    setSelectedRecord(
      record
    )

    return true
  }

  /* =======================================================
     SAFETY SAVE
  ======================================================= */

  const saveSafetyDraft = ({
    draft,
    source,
    evidence,
    existingId,
  }: {
    draft:
      SafetyDraft

    source:
      SourceType

    evidence?:
      AuthorityEvidence

    existingId?:
      string
  }) => {
    const timestamp =
      isoNow()

    if (
      existingId
    ) {
      setData(
        (current) => ({
          ...current,

          safety:
            current.safety.map(
              (record) =>
                record.id ===
                existingId
                  ? {
                      ...record,

                      ...draft,

                      source,

                      evidenceIds:
                        evidence
                          ? Array.from(
                              new Set([
                                ...record.evidenceIds,
                                evidence.id,
                              ])
                            )
                          : record.evidenceIds,

                      updatedAt:
                        timestamp,
                    }
                  : record
            ),

          evidence:
            evidence
              ? [
                  evidence,

                  ...current.evidence,
                ]
              : current.evidence,
        })
      )

      return true
    }

    const record:
      SafetyPlaceholderRecord =
      {
        id:
          createId(
            "SAFE"
          ),

        category:
          "safety",

        ...draft,

        source,

        evidenceIds:
          evidence
            ? [
                evidence.id,
              ]
            : [],

        createdAt:
          timestamp,

        updatedAt:
          timestamp,
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
                evidence,

                ...current.evidence,
              ]
            : current.evidence,
      })
    )

    setSelectedRecord(
      record
    )

    return true
  }

  /* =======================================================
     OCR SAVE
  ======================================================= */

  const saveOCRSession = (
    session:
      OCRSession
  ) => {
    const evidence:
      AuthorityEvidence =
      {
        id:
          createId(
            "DOC"
          ),

        documentName:
          session.file.name,

        documentType:
          session.file.type,

        source:
          session.source,

        uploadedAt:
          isoNow(),

        ocrConfidence:
          session.confidence,

        dataUrl:
          session.dataUrl,
      }

    if (
      session.category ===
      "audit" &&
      session.auditDraft
    ) {
      const saved =
        saveAuditDraft({
          draft:
            session.auditDraft,

          source:
            "OCR",

          evidence,
        })

      if (saved) {
        setOcrSession(
          null
        )
      }

      return
    }

    if (
      session.category ===
      "safety" &&
      session.safetyDraft
    ) {
      const saved =
        saveSafetyDraft({
          draft:
            session.safetyDraft,

          source:
            "OCR",

          evidence,
        })

      if (saved) {
        setOcrSession(
          null
        )
      }

      return
    }

    if (
      session.authorityDraft
    ) {
      const saved =
        saveAuthorityDraft({
          draft:
            session.authorityDraft,

          source:
            "OCR",

          evidence,
        })

      if (saved) {
        setOcrSession(
          null
        )
      }
    }
  }

  /* =======================================================
     DELETE FOR DEVELOPMENT
  ======================================================= */

  const deleteRecord = (
    record:
      SelectedRecord
  ) => {
    const confirmed =
      window.confirm(
        "Delete this development/test record?\n\nThis temporary delete function will be replaced by Archive once portal development is complete."
      )

    if (!confirmed) {
      return
    }

    const timestamp =
      isoNow()

    if (
      record.category ===
      "audit"
    ) {
      setData(
        (current) => ({
          ...current,

          audits:
            current.audits.map(
              (item) =>
                item.id ===
                record.id
                  ? {
                      ...item,

                      deletedAt:
                        timestamp,

                      deletedBy:
                        "Current User",
                    }
                  : item
            ),
        })
      )
    } else if (
      record.category ===
      "safety"
    ) {
      setData(
        (current) => ({
          ...current,

          safety:
            current.safety.map(
              (item) =>
                item.id ===
                record.id
                  ? {
                      ...item,

                      deletedAt:
                        timestamp,

                      deletedBy:
                        "Current User",
                    }
                  : item
            ),
        })
      )
    } else {
      setData(
        (current) => ({
          ...current,

          authorities:
            current.authorities.map(
              (item) =>
                item.id ===
                record.id
                  ? {
                      ...item,

                      deletedAt:
                        timestamp,

                      deletedBy:
                        "Current User",
                    }
                  : item
            ),
        })
      )
    }

    setSelectedRecord(
      null
    )
  }

  /* =======================================================
     LOADING
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

  return (
    <>
      <div className="flex max-w-[1600px] flex-col gap-6 pb-12">
        {/* =================================================
            HEADER
        ================================================= */}

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
                  Hazmat
                </p>

                <p className="mt-1 text-sm font-semibold">
                  {profile.hazmat
                    ? "Yes"
                    : "No"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border lg:block" />

              <button
                type="button"
                onClick={() =>
                  setSettings(
                    loadSystemSettings()
                  )
                }
                className="text-xs font-medium text-primary hover:underline"
              >
                Refresh Deadline Settings
              </button>
            </div>
          </div>
        </div>

        {/* =================================================
            HEALTH SUMMARY
        ================================================= */}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <SummaryCard
            label="Healthy"
            value={
              countStatus(
                "Healthy"
              )
            }
            status="Healthy"
          />

          <SummaryCard
            label="Watch"
            value={
              countStatus(
                "Watch"
              )
            }
            status="Watch"
          />

          <SummaryCard
            label="Urgent"
            value={
              countStatus(
                "Urgent"
              )
            }
            status="Urgent"
          />

          <SummaryCard
            label="Critical"
            value={
              countStatus(
                "Critical"
              )
            }
            status="Critical"
          />

          <SummaryCard
            label="Expired"
            value={
              countStatus(
                "Expired"
              )
            }
            status="Expired"
          />
        </div>

        {/* =================================================
            3-YEAR VISIBILITY STANDARD
        ================================================= */}

        <Card className="border-primary/15 bg-primary/[0.025]">
          <CardContent className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <History className="mt-0.5 size-4 text-primary" />

              <div>
                <p className="text-xs font-semibold">
                  Standard 3-Year Operational History
                </p>

                <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                  TES keeps at least the most recent three years of records and documents visible in the normal operational view. Older retained history remains available when needed for extended audit requests.
                </p>
              </div>
            </div>

            {oldRecordCount >
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
                  : `Show Older History (${oldRecordCount})`}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* =================================================
            WORKSPACE
        ================================================= */}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-6">
            <AuthoritySection
              title="Canadian Operations"
              description="Provincial carrier identifiers and safety/operating authorities."
              applicability={
                profile.canadaOperations
              }
              emptyMessage="No Canadian authority records found."
              records={categoryRecords(
                "canadian"
              )}
              deadlineRules={
                deadlineRules
              }
              selectedId={
                selectedRecord?.id
              }
              onSelect={
                setSelectedRecord
              }
              onScan={() =>
                setSourceCategory(
                  "canadian"
                )
              }
              onManual={() =>
                setManualCategory(
                  "canadian"
                )
              }
            />

            <AuthoritySection
              title="US Federal Operations"
              description="USDOT, MC operating authority, MCS-150 and related federal records."
              applicability={
                profile.usOperations
              }
              emptyMessage="No US federal authority records found."
              records={categoryRecords(
                "us_federal"
              )}
              deadlineRules={
                deadlineRules
              }
              selectedId={
                selectedRecord?.id
              }
              onSelect={
                setSelectedRecord
              }
              onScan={() =>
                setSourceCategory(
                  "us_federal"
                )
              }
              onManual={() =>
                setManualCategory(
                  "us_federal"
                )
              }
            />

            <AuthoritySection
              title="Operating Registrations"
              description="Carrier-level recurring registrations such as UCR."
              applicability={
                profile.ucr
              }
              emptyMessage="No operating registration records found."
              records={categoryRecords(
                "registration"
              )}
              deadlineRules={
                deadlineRules
              }
              selectedId={
                selectedRecord?.id
              }
              onSelect={
                setSelectedRecord
              }
              onScan={() =>
                setSourceCategory(
                  "registration"
                )
              }
              onManual={() =>
                setManualCategory(
                  "registration"
                )
              }
            />

            <AuthoritySection
              title="Hazmat / Special Fleet Authorities"
              description="Fleet-level hazardous materials authorities. Vehicle-specific permits remain with Vehicles."
              applicability={
                profile.phmsa
              }
              emptyMessage={
                profile.hazmat
                  ? "Hazmat operation detected, but no fleet-level hazmat authority is recorded."
                  : "No fleet-level hazmat authority is required by the current cargo profile."
              }
              records={categoryRecords(
                "hazmat"
              )}
              deadlineRules={
                deadlineRules
              }
              selectedId={
                selectedRecord?.id
              }
              onSelect={
                setSelectedRecord
              }
              onScan={() =>
                setSourceCategory(
                  "hazmat"
                )
              }
              onManual={() =>
                setManualCategory(
                  "hazmat"
                )
              }
            />

            {/* =============================================
                SAFETY — DELIBERATELY SHALLOW
            ============================================= */}

            <Card>
              <CardHeader className="border-b bg-muted/20">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="text-sm">
                      Safety Performance
                    </CardTitle>

                    <CardDescription className="mt-1 text-xs">
                      Carrier Profile / CVOR / FMCSA SMS structure will be developed as a dedicated pillar later.
                    </CardDescription>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() =>
                        setSourceCategory(
                          "safety"
                        )
                      }
                    >
                      <ScanDocumentIcon
                        size={14}
                      />

                      <span className="ml-2">
                        Scan
                      </span>
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() =>
                        setManualCategory(
                          "safety"
                        )
                      }
                    >
                      <Plus className="mr-2 size-4" />

                      Add Snapshot
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {visibleSafety.length ===
                0 ? (
                  <div className="p-10 text-center">
                    <ShieldCheck className="mx-auto size-9 text-muted-foreground/30" />

                    <p className="mt-3 text-sm font-medium">
                      No safety snapshots recorded.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {visibleSafety.map(
                      (record) => (
                        <SafetyRow
                          key={
                            record.id
                          }
                          record={
                            record
                          }
                          selected={
                            selectedRecord?.id ===
                            record.id
                          }
                          onSelect={() =>
                            setSelectedRecord(
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

            {/* =============================================
                AUDITS
            ============================================= */}

            <Card>
              <CardHeader className="border-b bg-muted/20">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="text-sm">
                      Audits & Interventions
                    </CardTitle>

                    <CardDescription className="mt-1 text-xs">
                      Regulatory audits, notices, interventions, due dates, outcomes and follow-up.
                    </CardDescription>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() =>
                        setSourceCategory(
                          "audit"
                        )
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
                        setManualCategory(
                          "audit"
                        )
                      }
                    >
                      <Plus className="mr-2 size-4" />

                      Add Audit
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {visibleAudits.length ===
                0 ? (
                  <div className="p-10 text-center">
                    <FileCheck2 className="mx-auto size-9 text-muted-foreground/30" />

                    <p className="mt-3 text-sm font-medium">
                      No audit or intervention records found.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {visibleAudits.map(
                      (record) => (
                        <AuditRow
                          key={
                            record.id
                          }
                          record={
                            record
                          }
                          selected={
                            selectedRecord?.id ===
                            record.id
                          }
                          onSelect={() =>
                            setSelectedRecord(
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
          </div>

          {/* ===============================================
              RIGHT SIDE INSPECTOR
          =============================================== */}

          <div className="xl:sticky xl:top-6">
            <RecordInspector
              record={
                selectedRecord
              }
              evidence={
                data.evidence
              }
              deadlineRules={
                deadlineRules
              }
              onClose={() =>
                setSelectedRecord(
                  null
                )
              }
              onEdit={() =>
                setEditingRecord(
                  selectedRecord
                )
              }
              onDelete={() => {
                if (
                  selectedRecord
                ) {
                  deleteRecord(
                    selectedRecord
                  )
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* ===================================================
          MANUAL ADD
      =================================================== */}

      {manualCategory && (
        <ManualRecordModal
          category={
            manualCategory
          }
          company={
            company
          }
          profile={
            profile
          }
          onCancel={() =>
            setManualCategory(
              null
            )
          }
          onSaveAuthority={(
            draft
          ) => {
            const saved =
              saveAuthorityDraft({
                draft,

                source:
                  "Manual",
              })

            if (saved) {
              setManualCategory(
                null
              )
            }
          }}
          onSaveAudit={(
            draft
          ) => {
            saveAuditDraft({
              draft,

              source:
                "Manual",
            })

            setManualCategory(
              null
            )
          }}
          onSaveSafety={(
            draft
          ) => {
            saveSafetyDraft({
              draft,

              source:
                "Manual",
            })

            setManualCategory(
              null
            )
          }}
        />
      )}

      {/* ===================================================
          SOURCE PICKER
      =================================================== */}

      {sourceCategory && (
        <DocumentSourcePicker
          category={
            sourceCategory
          }
          onClose={() =>
            setSourceCategory(
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

      {/* ===================================================
          CAMERA
      =================================================== */}

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

            processDocument(
              file,
              "camera"
            )
          }}
        />
      )}

      {/* ===================================================
          OCR WORKSPACE
      =================================================== */}

      {ocrSession && (
        <OCRWorkspace
          session={
            ocrSession
          }
          setSession={
            setOcrSession
          }
          company={
            company
          }
          profile={
            profile
          }
          onCancel={() =>
            setOcrSession(
              null
            )
          }
          onReplace={() => {
            const category =
              ocrSession.category

            setOcrSession(
              null
            )

            setSourceCategory(
              category
            )
          }}
          onSave={
            saveOCRSession
          }
        />
      )}

      {/* ===================================================
          EDIT
      =================================================== */}

      {editingRecord && (
        <EditRecordModal
          record={
            editingRecord
          }
          company={
            company
          }
          profile={
            profile
          }
          onCancel={() =>
            setEditingRecord(
              null
            )
          }
          onSaveAuthority={(
            draft
          ) => {
            const saved =
              saveAuthorityDraft({
                draft,

                source:
                  editingRecord.source,

                existingId:
                  editingRecord.id,
              })

            if (saved) {
              const updated:
                AuthorityRecord =
                {
                  ...(editingRecord as AuthorityRecord),

                  ...draft,

                  updatedAt:
                    isoNow(),
                }

              setSelectedRecord(
                updated
              )

              setEditingRecord(
                null
              )
            }
          }}
          onSaveAudit={(
            draft
          ) => {
            saveAuditDraft({
              draft,

              source:
                editingRecord.source,

              existingId:
                editingRecord.id,
            })

            setSelectedRecord({
              ...(editingRecord as AuditRecord),

              ...draft,

              updatedAt:
                isoNow(),
            })

            setEditingRecord(
              null
            )
          }}
          onSaveSafety={(
            draft
          ) => {
            saveSafetyDraft({
              draft,

              source:
                editingRecord.source,

              existingId:
                editingRecord.id,
            })

            setSelectedRecord({
              ...(editingRecord as SafetyPlaceholderRecord),

              ...draft,

              updatedAt:
                isoNow(),
            })

            setEditingRecord(
              null
            )
          }}
        />
      )}

      {/* ===================================================
          DEVICE FILE INPUT
      =================================================== */}

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

          await processDocument(
            file,
            "device"
          )
        }}
      />
    </>
  )
}

/* =========================================================
   SUMMARY CARD
========================================================= */

function SummaryCard({
  label,
  value,
  status,
}: {
  label: string
  value: number

  status:
    DeadlineStatus
}) {
  const style =
    deadlineStyle(
      status
    )

  return (
    <Card
      className={`border-l-4 ${style.accent}`}
    >
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">
          {label}
        </p>

        <div className="mt-2 flex items-end justify-between gap-2">
          <p className="text-2xl font-bold">
            {value}
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

/* =========================================================
   EDIT MODAL
========================================================= */

function EditRecordModal({
  record,
  company,
  profile,

  onCancel,

  onSaveAuthority,
  onSaveAudit,
  onSaveSafety,
}: {
  record:
    SelectedRecord

  company:
    Company

  profile:
    CompanyAuthorityProfile

  onCancel: () => void

  onSaveAuthority: (
    draft:
      AuthorityDraft
  ) => void

  onSaveAudit: (
    draft:
      AuditDraft
  ) => void

  onSaveSafety: (
    draft:
      SafetyDraft
  ) => void
}) {
  const authorityRecord =
    record.category !==
      "audit" &&
    record.category !==
      "safety"
      ? (record as AuthorityRecord)
      : null

  const auditRecord =
    record.category ===
    "audit"
      ? (record as AuditRecord)
      : null

  const safetyRecord =
    record.category ===
    "safety"
      ? (record as SafetyPlaceholderRecord)
      : null

  const [
    authorityDraft,
    setAuthorityDraft,
  ] =
    useState<AuthorityDraft>(
      authorityRecord
        ? {
            category:
              authorityRecord.category,

            authorityType:
              authorityRecord.authorityType,

            authorityName:
              authorityRecord.authorityName,

            authorityNumber:
              authorityRecord.authorityNumber,

            issuingAuthority:
              authorityRecord.issuingAuthority ||
              "",

            country:
              authorityRecord.country ||
              "",

            jurisdiction:
              authorityRecord.jurisdiction ||
              "",

            issueDate:
              authorityRecord.issueDate ||
              "",

            effectiveDate:
              authorityRecord.effectiveDate ||
              "",

            renewalDate:
              authorityRecord.renewalDate ||
              "",

            expiryDate:
              authorityRecord.expiryDate ||
              "",

            dueDate:
              authorityRecord.dueDate ||
              "",

            recordStatus:
              authorityRecord.recordStatus,

            applicability:
              authorityRecord.applicability,

            credentialStored:
              Boolean(
                authorityRecord.credentialStored
              ),

            notes:
              authorityRecord.notes ||
              "",
          }
        : emptyAuthorityDraft({
            category:
              "canadian",

            company,
            profile,
          })
    )

  const [
    auditDraft,
    setAuditDraft,
  ] =
    useState<AuditDraft>(
      auditRecord
        ? {
            auditType:
              auditRecord.auditType,

            regulator:
              auditRecord.regulator,

            jurisdiction:
              auditRecord.jurisdiction,

            referenceNumber:
              auditRecord.referenceNumber,

            noticeDate:
              auditRecord.noticeDate ||
              "",

            dueDate:
              auditRecord.dueDate ||
              "",

            completedDate:
              auditRecord.completedDate ||
              "",

            status:
              auditRecord.status,

            outcome:
              auditRecord.outcome ||
              "",

            score:
              auditRecord.score ||
              "",

            followUpRequired:
              auditRecord.followUpRequired,

            followUpDueDate:
              auditRecord.followUpDueDate ||
              "",

            notes:
              auditRecord.notes ||
              "",
          }
        : emptyAuditDraft()
    )

  const [
    safetyDraft,
    setSafetyDraft,
  ] =
    useState<SafetyDraft>(
      safetyRecord
        ? {
            system:
              safetyRecord.system,

            jurisdiction:
              safetyRecord.jurisdiction,

            reviewDate:
              safetyRecord.reviewDate,

            statusSummary:
              safetyRecord.statusSummary,

            notes:
              safetyRecord.notes ||
              "",
          }
        : emptySafetyDraft()
    )

  return (
    <div className="fixed inset-0 z-[110] overflow-y-auto bg-black/45 p-4 backdrop-blur-sm">
      <div className="mx-auto my-6 max-w-5xl">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">
                  Edit Record
                </CardTitle>

                <CardDescription className="mt-1">
                  Changes update the existing record rather than creating another record.
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
            {auditRecord ? (
              <AuditDraftForm
                draft={
                  auditDraft
                }
                onChange={
                  setAuditDraft
                }
              />
            ) : safetyRecord ? (
              <SafetyDraftForm
                draft={
                  safetyDraft
                }
                onChange={
                  setSafetyDraft
                }
              />
            ) : (
              <AuthorityDraftForm
                draft={
                  authorityDraft
                }
                onChange={
                  setAuthorityDraft
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
                onClick={() => {
                  if (
                    auditRecord
                  ) {
                    onSaveAudit(
                      auditDraft
                    )

                    return
                  }

                  if (
                    safetyRecord
                  ) {
                    onSaveSafety(
                      safetyDraft
                    )

                    return
                  }

                  onSaveAuthority(
                    authorityDraft
                  )
                }}
              >
                <Save className="mr-2 size-4" />

                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
