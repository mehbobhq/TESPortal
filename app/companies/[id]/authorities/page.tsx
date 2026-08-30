"use client"

import React, {
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
  CheckCircle2,
  Copy,
  FileCheck2,
  FileText,
  History,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Archive,
  ArchiveRestore,
  Upload,
  X,
  XCircle,
  Eye,
  Check,
} from "lucide-react"

import {
  getDaysRemaining,
  getDeadlineStatus,
  DEFAULT_DEADLINE_RULES,
  getDeadlineClasses,
} from "@/lib/deadline-engine"
import {
  JURISDICTIONS,
  resolveCountryForJurisdiction,
  getJurisdictionLabel,
} from "@/lib/jurisdictions"
import {
  normalizeUSDOT,
  normalizeMC,
  normalizeTaxId,
} from "@/src/lib/identifier-normalization"
import { recordAuditEvent } from "@/lib/audit-logger"
import { ReadOnlyField, RegulatoryIdentifierField } from "@/src/components/shared/ReadOnlyField"
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer"
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker"
import { CameraCapture } from "@/src/components/CameraCapture"
import { LoadingState, EmptyState, ErrorAlert } from "@/src/components/shared/StateDisplays"

/* =========================================================
   TYPES
========================================================= */

export type DeadlineStatus =
  | "Healthy"
  | "Watch"
  | "Urgent"
  | "Critical"
  | "Expired"
  | "No Deadline"

export type DeadlineRules = {
  healthyMinDays: number
  watchMinDays: number
  urgentMinDays: number
  criticalMinDays: number
  criticalMaxDays: number
}

export type Company = {
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

  usdot?: string
  mc?: string
  mvid?: string
  nsc?: string
  accIrp?: string
  accIfta?: string
  accNyhut?: string
  accNm?: string
  accKyu?: string
  accOr?: string
  accCt?: string
  scac?: string
  carrierCode?: string

  cargoTypes?: string[]
  cargoInformation?: unknown
  hazmat?: boolean

  [key: string]: any
}

export type AuthorityCategory =
  | "canadian"
  | "us_federal"
  | "operating_registration"

export type AuthorityType =
  | "PROVINCIAL_CARRIER_IDENTIFIER"
  | "CANADIAN_SAFETY_AUTHORITY"
  | "USDOT"
  | "MC"
  | "MCS150"
  | "UCR"
  | "PHMSA"
  | "OTHER"

export type SafetySystem =
  | "CARRIER_PROFILE_CVOR"
  | "SMS_PROFILE"

export type SourceType =
  | "OCR"
  | "Manual"

export type DocumentSource =
  | "camera"
  | "device"

export interface AuthorityEvidence {
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

export interface AuthorityRecord {
  id: string
  category: AuthorityCategory
  authorityType: AuthorityType
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
    | "Archived"
  issueDate?: string
  effectiveDate?: string
  expiryDate?: string
  eventDate?: string
  nextActionDate?: string
  notes?: string
  evidenceIds: string[]
  source: SourceType
  createdAt: string
  updatedAt: string
  isArchived?: boolean
  archivedAt?: string
  archivedBy?: string
  archiveReason?: string
}

export interface SafetyRecord {
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
  isArchived?: boolean
  archivedAt?: string
  archivedBy?: string
  archiveReason?: string
}

export interface AuditRecord {
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
  isArchived?: boolean
  archivedAt?: string
  archivedBy?: string
  archiveReason?: string
}

export interface StoredAuthoritiesData {
  version: number
  authorities: AuthorityRecord[]
  safety: SafetyRecord[]
  audits: AuditRecord[]
  evidence: AuthorityEvidence[]
}

export type SelectedRecord =
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

export interface AuthorityDraft {
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

export interface SafetyDraft {
  system: SafetySystem
  jurisdictionCode: string
  jurisdictionLabel: string
  country: string
  reviewDate: string
  summary: string
  notes: string
}

export interface AuditDraft {
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

export interface OCRSession {
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
  documentDate: string
  authorityDraft?: AuthorityDraft
  safetyDraft?: SafetyDraft
  auditDraft?: AuditDraft
}

/* =========================================================
   CONSTANTS
========================================================= */

const SYSTEM_SETTINGS_KEY = "tes_system_settings"
const THREE_YEAR_HISTORY = 3

const EMPTY_DATA: StoredAuthoritiesData = {
  version: 3,
  authorities: [],
  safety: [],
  audits: [],
  evidence: [],
}

/* =========================================================
   HELPERS & REPOSITORY UTILITIES
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

function normalizeIdentifier(value?: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

function normalizeText(value?: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

function getCompanies(): Company[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadDeadlineRules(): DeadlineRules {
  try {
    const raw = localStorage.getItem(SYSTEM_SETTINGS_KEY)
    if (!raw) {
      return DEFAULT_DEADLINE_RULES
    }
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_DEADLINE_RULES,
      ...(parsed.deadlineRules || parsed.expiryRules || {}),
    }
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

/* =========================================================
   CROSS-STORE ROLLBACK SNAPSHOT
========================================================= */

type CrossStoreSnapshot = {
  companies: string | null
  authorities: string | null
}

function captureCrossStoreSnapshot(companyId: string): CrossStoreSnapshot {
  return {
    companies: localStorage.getItem("tes_companies"),
    authorities: localStorage.getItem(`tes_company_authorities_${companyId}`),
  }
}

function rollbackCrossStoreSnapshot(companyId: string, snapshot: CrossStoreSnapshot) {
  try {
    if (snapshot.companies !== null) {
      localStorage.setItem("tes_companies", snapshot.companies)
    }
    if (snapshot.authorities !== null) {
      localStorage.setItem(`tes_company_authorities_${companyId}`, snapshot.authorities)
    }
  } catch (err) {
    console.error("Failed to rollback cross-store snapshot:", err)
  }
}

/* =========================================================
   COMPANY APPLICABILITY
========================================================= */

function companyHasHazmat(company: Company) {
  if (company.hazmat === true) {
    return true
  }

  if (
    Array.isArray(company.cargoTypes) &&
    company.cargoTypes.some((item) => {
      const text = normalizeText(item)
      return text.includes("haz") || text.includes("dangerous goods")
    })
  ) {
    return true
  }

  if (company.cargoInformation) {
    const text = JSON.stringify(company.cargoInformation).toLowerCase()
    if (
      text.includes('"hazmat":true') ||
      text.includes('"hazardous":true') ||
      text.includes('"dangerousgoods":true') ||
      text.includes('"dangerous_goods":true')
    ) {
      return true
    }
  }

  return false
}

export type AuthorityProfile = {
  showCanadian: boolean
  showUS: boolean
  showUCR: boolean
  showPHMSA: boolean
  showCarrierProfile: boolean
  showSMSProfile: boolean
  hazmat: boolean
}

function deriveAuthorityProfile(company: Company): AuthorityProfile {
  const country = normalizeText(company.regCorpCountry)
  const region = normalizeText(company.region)

  const crossBorder = region.includes("cross")

  const canadaOnly =
    !crossBorder &&
    (region.includes("canada") ||
      (country.includes("canada") &&
        !region.includes("united states") &&
        !region.includes("usa")))

  const usOnly =
    !crossBorder &&
    (region.includes("united states") ||
      region.includes("usa") ||
      region.includes("us only") ||
      (country.includes("united states") && !region.includes("canada")))

  let showCanadian = false
  let showUS = false

  if (crossBorder) {
    showCanadian = true
    showUS = true
  } else if (canadaOnly) {
    showCanadian = true
  } else if (usOnly) {
    showUS = true
  } else {
    showCanadian = country.includes("canada")
    showUS =
      country.includes("united states") ||
      country === "usa" ||
      country === "us"
  }

  const hazmat = companyHasHazmat(company)

  return {
    showCanadian,
    showUS,
    showUCR: showUS,
    showPHMSA: showUS && hazmat,
    showCarrierProfile: showCanadian,
    showSMSProfile: showUS,
    hazmat,
  }
}

/* =========================================================
   THREE-YEAR HISTORY
========================================================= */

function historyCutoffDate() {
  const date = new Date()
  date.setFullYear(date.getFullYear() - THREE_YEAR_HISTORY)
  return date
}

function isDateInsideThreeYears(dateValue?: string) {
  if (!dateValue) {
    return true
  }
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) {
    return true
  }
  return date >= historyCutoffDate()
}

function authorityReferenceDate(record: AuthorityRecord) {
  return (
    record.expiryDate ||
    record.eventDate ||
    record.effectiveDate ||
    record.issueDate ||
    record.createdAt
  )
}

function safetyReferenceDate(record: SafetyRecord) {
  return record.reviewDate || record.createdAt
}

function auditReferenceDate(record: AuditRecord) {
  return record.completedDate || record.noticeDate || record.createdAt
}

/* =========================================================
   DEADLINE BADGE
========================================================= */

function DeadlineBadge({ status }: { status: DeadlineStatus }) {
  const style = getDeadlineClasses(status)

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${style.badge}`}
    >
      {status === "Healthy" && <CheckCircle2 className="size-3" />}
      {status === "Watch" && <CalendarClock className="size-3" />}
      {(status === "Urgent" || status === "Critical") && (
        <AlertTriangle className="size-3" />
      )}
      {status === "Expired" && <XCircle className="size-3" />}
      {status}
    </span>
  )
}

/* =========================================================
   GLOBAL DUPLICATION DETECTION
========================================================= */

function findGlobalAuthorityConflict({
  currentCompanyId,
  authorityType,
  number,
  editingId,
}: {
  currentCompanyId: string
  authorityType: AuthorityType
  number: string
  editingId?: string
}) {
  const normalizedNumber = normalizeIdentifier(number)
  if (!normalizedNumber) {
    return null
  }

  for (const company of getCompanies()) {
    try {
      const raw = localStorage.getItem(`tes_company_authorities_${company.id}`)
      if (!raw) {
        continue
      }
      const parsed = JSON.parse(raw)
      const records: AuthorityRecord[] = Array.isArray(parsed?.authorities)
        ? parsed.authorities
        : []

      const match = records.find(
        (record) =>
          record.id !== editingId &&
          !record.isArchived &&
          record.authorityType === authorityType &&
          normalizeIdentifier(record.number) === normalizedNumber
      )

      if (match) {
        return {
          companyId: company.id,
          companyName: company.name,
          sameCompany: company.id === currentCompanyId,
          record: match,
        }
      }
    } catch {
      // Ignore malformed storage
    }
  }

  return null
}

/* =========================================================
   STANDARD OCR ICON
========================================================= */

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
   JURISDICTION / COUNTRY FORM FIELD
========================================================= */

function JurisdictionCountryFields({
  jurisdictionCode,
  country,
  allowedCountries,
  onChange,
}: {
  jurisdictionCode: string
  country: string
  allowedCountries?: ("Canada" | "United States")[]
  onChange: (value: {
    jurisdictionCode: string
    jurisdictionLabel: string
    country: string
  }) => void
}) {
  const options = allowedCountries?.length
    ? JURISDICTIONS.filter((item) => allowedCountries.includes(item.country))
    : JURISDICTIONS

  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Jurisdiction *</label>
        <select
          value={jurisdictionCode || ""}
          onChange={(e) => {
            const code = e.target.value
            const selected = JURISDICTIONS.find((item) => item.code === code)
            if (!selected) return

            onChange({
              jurisdictionCode: selected.code,
              jurisdictionLabel: selected.label,
              country: selected.country,
            })
          }}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="" disabled>Select jurisdiction</option>
          {options.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label} ({item.code})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Country</label>
        <input
          type="text"
          value={country}
          readOnly
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-muted/40 text-muted-foreground focus:outline-none"
        />
      </div>
    </>
  )
}

/* =========================================================
   AUTHORITY CONFIG
========================================================= */

function authorityDisplayName(type: AuthorityType) {
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

function defaultIssuingAuthority(type: AuthorityType) {
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
  category: AuthorityCategory,
  profile: AuthorityProfile
): { value: AuthorityType; label: string }[] {
  if (category === "canadian") {
    return [
      {
        value: "PROVINCIAL_CARRIER_IDENTIFIER",
        label: "Provincial Carrier Identifier (MVID / RIN)",
      },
      {
        value: "CANADIAN_SAFETY_AUTHORITY",
        label: "NSC / Safety Fitness Certificate / CVOR",
      },
    ]
  }

  if (category === "us_federal") {
    return [
      {
        value: "USDOT",
        label: "USDOT Number",
      },
      {
        value: "MC",
        label: "MC Operating Authority",
      },
      {
        value: "MCS150",
        label: "MCS-150 Biennial Update",
      },
    ]
  }

  const options: { value: AuthorityType; label: string }[] = []
  if (profile.showUCR) {
    options.push({
      value: "UCR",
      label: "Unified Carrier Registration (UCR)",
    })
  }
  if (profile.showPHMSA) {
    options.push({
      value: "PHMSA",
      label: "PHMSA Registration",
    })
  }
  return options
}

/* =========================================================
   DEFAULT JURISDICTIONS / DRAFTS
========================================================= */

function defaultJurisdictionFor(
  company: Company,
  category: AuthorityCategory
) {
  if (category === "us_federal" || category === "operating_registration") {
    return {
      code: "US-FED",
      label: "Federal — United States",
      country: "United States",
    }
  }

  const state = normalizeText(company.regCorpState)
  const found = JURISDICTIONS.find(
    (item) =>
      item.country === "Canada" &&
      (normalizeText(item.code) === state || normalizeText(item.label) === state)
  )

  return (
    found || {
      code: "CA-FED",
      label: "Federal — Canada",
      country: "Canada",
    }
  )
}

function emptyAuthorityDraft(
  company: Company,
  category: AuthorityCategory,
  type?: AuthorityType
): AuthorityDraft {
  const jurisdiction = defaultJurisdictionFor(company, category)
  const authorityType =
    type ||
    (category === "canadian"
      ? "PROVINCIAL_CARRIER_IDENTIFIER"
      : category === "us_federal"
      ? "USDOT"
      : "UCR")

  return {
    category,
    authorityType,
    name: authorityDisplayName(authorityType),
    number: "",
    issuingAuthority: defaultIssuingAuthority(authorityType),
    jurisdictionCode: jurisdiction.code,
    jurisdictionLabel: jurisdiction.label,
    country: jurisdiction.country,
    status: "Active",
    issueDate: "",
    effectiveDate: "",
    expiryDate: "",
    eventDate: "",
    nextActionDate: "",
    notes: "",
  }
}

function emptySafetyDraft(company: Company, system: SafetySystem): SafetyDraft {
  const jurisdiction =
    system === "SMS_PROFILE"
      ? { code: "US-FED", label: "Federal — United States", country: "United States" }
      : defaultJurisdictionFor(company, "canadian")

  return {
    system,
    jurisdictionCode: jurisdiction.code,
    jurisdictionLabel: jurisdiction.label,
    country: jurisdiction.country,
    reviewDate: todayISO(),
    summary: "",
    notes: "",
  }
}

function emptyAuditDraft(company: Company): AuditDraft {
  const canada = normalizeText(company.regCorpCountry).includes("canada")
  const country = canada ? "Canada" : "United States"

  const jurisdiction =
    JURISDICTIONS.find(
      (item) =>
        item.country === country &&
        normalizeText(item.label) === normalizeText(company.regCorpState)
    ) || {
      code: canada ? "CA-FED" : "US-FED",
      label: canada ? "Federal — Canada" : "Federal — United States",
      country,
    }

  return {
    auditType: "",
    regulator: "",
    jurisdictionCode: jurisdiction.code,
    jurisdictionLabel: jurisdiction.label,
    country: jurisdiction.country,
    referenceNumber: "",
    noticeDate: "",
    dueDate: "",
    completedDate: "",
    status: "Open",
    outcome: "",
    score: "",
    followUpRequired: false,
    followUpDueDate: "",
    notes: "",
  }
}

/* =========================================================
   AUTHORITY FORM
========================================================= */

function AuthorityForm({
  draft,
  profile,
  onChange,
}: {
  draft: AuthorityDraft
  profile: AuthorityProfile
  onChange: (draft: AuthorityDraft) => void
}) {
  const options = authorityOptions(draft.category, profile)
  const periodic = draft.authorityType === "MCS150"
  const allowedCountries: ("Canada" | "United States")[] =
    draft.category === "canadian" ? ["Canada"] : ["United States"]

  const patch = (value: Partial<AuthorityDraft>) => {
    onChange({ ...draft, ...value })
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/20 px-5 py-3.5">
        <h4 className="text-sm font-semibold text-foreground">Authority / Registration Information</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          OCR and manual entry use the same authoritative fields.
        </p>
      </div>

      <div className="p-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Record Type *</label>
          <select
            value={draft.authorityType}
            onChange={(e) => {
              const type = e.target.value as AuthorityType
              patch({
                authorityType: type,
                name: authorityDisplayName(type),
                issuingAuthority: defaultIssuingAuthority(type),
              })
            }}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Display Name *</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            {periodic
              ? "Reference / Filing Number"
              : "Authority / Registration Number *"}
          </label>
          <input
            type="text"
            value={draft.number}
            onChange={(e) => patch({ number: e.target.value })}
            placeholder={
              draft.authorityType === "USDOT"
                ? "e.g. 3928102"
                : draft.authorityType === "MC"
                ? "e.g. MC-849201"
                : "Enter identifier"
            }
            className="w-full px-3 py-2 text-xs font-mono border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Issuing Authority</label>
          <input
            type="text"
            value={draft.issuingAuthority}
            onChange={(e) => patch({ issuingAuthority: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <JurisdictionCountryFields
          jurisdictionCode={draft.jurisdictionCode}
          country={draft.country}
          allowedCountries={allowedCountries}
          onChange={(value) => patch(value)}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Record Status</label>
          <select
            value={draft.status}
            onChange={(e) =>
              patch({ status: e.target.value as AuthorityRecord["status"] })
            }
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="Active">Active</option>
            <option value="Pending">Pending</option>
            <option value="Inactive">Inactive</option>
            <option value="Suspended">Suspended</option>
            <option value="Expired">Expired</option>
          </select>
        </div>

        {periodic ? (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Filed / Update Date</label>
              <input
                type="date"
                value={draft.eventDate}
                onChange={(e) => patch({ eventDate: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Next Action Date</label>
              <input
                type="date"
                value={draft.nextActionDate}
                onChange={(e) => patch({ nextActionDate: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-[10px] text-muted-foreground">
                Next scheduled biennial filing deadline calculated from USDOT number.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Issue Date</label>
              <input
                type="date"
                value={draft.issueDate}
                onChange={(e) => patch({ issueDate: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Effective Date</label>
              <input
                type="date"
                value={draft.effectiveDate}
                onChange={(e) => patch({ effectiveDate: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Expiry Date</label>
              <input
                type="date"
                value={draft.expiryDate}
                onChange={(e) => patch({ expiryDate: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </>
        )}

        <div className="space-y-1.5 md:col-span-2">
          <label className="text-xs font-semibold text-foreground">Notes</label>
          <input
            type="text"
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Optional compliance notes or reference details"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   SAFETY FORM
========================================================= */

function SafetyForm({
  draft,
  onChange,
}: {
  draft: SafetyDraft
  onChange: (draft: SafetyDraft) => void
}) {
  const patch = (value: Partial<SafetyDraft>) => {
    onChange({ ...draft, ...value })
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/20 px-5 py-3.5">
        <h4 className="text-sm font-semibold text-foreground">
          {draft.system === "CARRIER_PROFILE_CVOR"
            ? "Carrier Profile / CVOR Snapshot"
            : "SMS Safety Profile Snapshot"}
        </h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          High-level safety ratings and review records.
        </p>
      </div>

      <div className="p-5 grid gap-4 md:grid-cols-2">
        <JurisdictionCountryFields
          jurisdictionCode={draft.jurisdictionCode}
          country={draft.country}
          allowedCountries={
            draft.system === "CARRIER_PROFILE_CVOR"
              ? ["Canada"]
              : ["United States"]
          }
          onChange={(value) => patch(value)}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Review Date</label>
          <input
            type="date"
            value={draft.reviewDate}
            onChange={(e) => patch({ reviewDate: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Status Summary</label>
          <input
            type="text"
            value={draft.summary}
            onChange={(e) => patch({ summary: e.target.value })}
            placeholder="e.g. Satisfactory / 0% Safety Rating / No Violations"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <label className="text-xs font-semibold text-foreground">Notes</label>
          <input
            type="text"
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   AUDIT FORM
========================================================= */

function AuditForm({
  draft,
  onChange,
}: {
  draft: AuditDraft
  onChange: (draft: AuditDraft) => void
}) {
  const patch = (value: Partial<AuditDraft>) => {
    onChange({ ...draft, ...value })
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/20 px-5 py-3.5">
        <h4 className="text-sm font-semibold text-foreground">Audit / Intervention Details</h4>
      </div>

      <div className="p-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Audit / Intervention Type *</label>
          <input
            type="text"
            value={draft.auditType}
            onChange={(e) => patch({ auditType: e.target.value })}
            placeholder="e.g. FMCSA Comprehensive Review, CVOR Audit"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Regulator / Authority *</label>
          <input
            type="text"
            value={draft.regulator}
            onChange={(e) => patch({ regulator: e.target.value })}
            placeholder="e.g. FMCSA, MTO, Alberta Transportation"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <JurisdictionCountryFields
          jurisdictionCode={draft.jurisdictionCode}
          country={draft.country}
          onChange={(value) => patch(value)}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Notice / Reference Number</label>
          <input
            type="text"
            value={draft.referenceNumber}
            onChange={(e) => patch({ referenceNumber: e.target.value })}
            className="w-full px-3 py-2 text-xs font-mono border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Notice Date</label>
          <input
            type="date"
            value={draft.noticeDate}
            onChange={(e) => patch({ noticeDate: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Due Date</label>
          <input
            type="date"
            value={draft.dueDate}
            onChange={(e) => patch({ dueDate: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Completed Date</label>
          <input
            type="date"
            value={draft.completedDate}
            onChange={(e) => patch({ completedDate: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Status</label>
          <select
            value={draft.status}
            onChange={(e) =>
              patch({ status: e.target.value as AuditRecord["status"] })
            }
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="Open">Open</option>
            <option value="Scheduled">Scheduled</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
            <option value="Closed">Closed</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Outcome</label>
          <input
            type="text"
            value={draft.outcome}
            onChange={(e) => patch({ outcome: e.target.value })}
            placeholder="e.g. Satisfactory, Conditional, Closed with No Action"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Score / Rating</label>
          <input
            type="text"
            value={draft.score}
            onChange={(e) => patch({ score: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Follow-up Required</label>
          <select
            value={draft.followUpRequired ? "yes" : "no"}
            onChange={(e) =>
              patch({ followUpRequired: e.target.value === "yes" })
            }
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>

        {draft.followUpRequired && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Follow-up Due Date</label>
            <input
              type="date"
              value={draft.followUpDueDate}
              onChange={(e) => patch({ followUpDueDate: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        <div className="space-y-1.5 md:col-span-2">
          <label className="text-xs font-semibold text-foreground">Notes</label>
          <input
            type="text"
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   MANUAL MODAL
========================================================= */

type ManualState =
  | {
      mode: "authority"
      draft: AuthorityDraft
    }
  | {
      mode: "safety"
      draft: SafetyDraft
    }
  | {
      mode: "audit"
      draft: AuditDraft
    }

function ManualModal({
  state,
  profile,
  onChange,
  onCancel,
  onSave,
}: {
  state: ManualState
  profile: AuthorityProfile
  onChange: (state: ManualState) => void
  onCancel: () => void
  onSave: () => void
}) {
  const ready =
    state.mode === "authority"
      ? Boolean(
          state.draft.name.trim() &&
            (state.draft.authorityType === "MCS150" ||
              state.draft.number.trim())
        )
      : state.mode === "safety"
      ? Boolean(state.draft.reviewDate)
      : Boolean(state.draft.auditType.trim() && state.draft.regulator.trim())

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-black/45 p-4 backdrop-blur-sm flex items-center justify-center">
      <div className="w-full max-w-5xl my-6 bg-card border border-border rounded-2xl shadow-xl overflow-hidden">
        <div className="border-b border-border px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {state.mode === "authority"
                ? "Add Authority / Registration"
                : state.mode === "safety"
                ? "Add Safety Snapshot"
                : "Add Audit / Intervention"}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manual entry uses the same authoritative record model as OCR.
            </p>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {state.mode === "authority" && (
            <AuthorityForm
              draft={state.draft}
              profile={profile}
              onChange={(draft) =>
                onChange({
                  mode: "authority",
                  draft,
                })
              }
            />
          )}

          {state.mode === "safety" && (
            <SafetyForm
              draft={state.draft}
              onChange={(draft) =>
                onChange({
                  mode: "safety",
                  draft,
                })
              }
            />
          )}

          {state.mode === "audit" && (
            <AuditForm
              draft={state.draft}
              onChange={(draft) =>
                onChange({
                  mode: "audit",
                  draft,
                })
              }
            />
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!ready}
              onClick={onSave}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
            >
              <Save className="size-4" />
              Save Record
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   OCR REQUEST & WORKSPACE
========================================================= */

async function requestOCR(session: OCRSession): Promise<Partial<OCRSession>> {
  try {
    const body = new FormData()
    body.append("file", session.file)
    body.append("mode", session.mode)

    if (session.authorityDraft) {
      body.append("category", session.authorityDraft.category)
      body.append("authorityType", session.authorityDraft.authorityType)
    }

    if (session.safetyDraft) {
      body.append("safetySystem", session.safetyDraft.system)
    }

    const response = await fetch("/api/document-intelligence/authorities", {
      method: "POST",
      body,
    })

    if (response.ok) {
      return await response.json()
    }
  } catch {
    // Fallback on network or endpoint failure
  }

  return {
    extractionComplete: true,
  }
}

function OCRWorkspace({
  session,
  profile,
  companyName,
  setSession,
  onCancel,
  onReplace,
  onSave,
}: {
  session: OCRSession
  profile: AuthorityProfile
  companyName: string
  setSession: React.Dispatch<React.SetStateAction<OCRSession | null>>
  onCancel: () => void
  onReplace: () => void
  onSave: () => void
}) {
  const run = async () => {
    setSession((current) =>
      current ? { ...current, processing: true } : current
    )

    const result = await requestOCR(session)

    setSession((current) =>
      current
        ? {
            ...current,
            ...result,
            processing: false,
            extractionComplete: true,
          }
        : current
    )
  }

  const ready =
    session.mode === "authority"
      ? Boolean(
          session.authorityDraft?.name.trim() &&
            (session.authorityDraft?.authorityType === "MCS150" ||
              session.authorityDraft?.number.trim())
        )
      : session.mode === "safety"
      ? Boolean(session.safetyDraft?.reviewDate)
      : Boolean(
          session.auditDraft?.auditType.trim() &&
            session.auditDraft?.regulator.trim()
        )

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-background">
      <div className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-5 bg-card">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ScanDocumentIcon size={18} />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">Document Intelligence Review</p>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold border border-primary/20 bg-primary/5 text-primary">
                <Sparkles className="size-3" />
                AI Assisted
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">{session.file.name}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(520px,1fr)_minmax(620px,1fr)]">
        <div className="min-h-0 border-r border-border">
          <SecureDocumentViewer
            fileName={session.file.name}
            mimeType={session.file.type}
            dataUrl={session.dataUrl}
            documentTitle="Authority Source Document"
            watermarkContext={{
              viewerName: "Safety Director",
              viewerRole: "Compliance Officer",
              companyName,
              timestamp: isoNow(),
            }}
            onReplace={onReplace}
          />
        </div>

        <div className="flex min-h-0 flex-col bg-card">
          <div className="border-b border-border p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Extracted Information</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  OCR is the primary intake layer. Review or correct extracted fields before saving.
                </p>
              </div>

              {session.confidence !== undefined && (
                <div className="text-right">
                  <p className="text-xl font-bold text-emerald-600">
                    {session.confidence}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">OCR confidence</p>
                </div>
              )}
            </div>

            {!session.extractionComplete && (
              <button
                type="button"
                disabled={session.processing}
                onClick={run}
                className="mt-4 inline-flex items-center px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
              >
                {session.processing ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <ScanDocumentIcon size={15} />
                    <span className="ml-2">Extract Data</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <div className="mb-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Document Date</label>
                <input
                  type="date"
                  value={session.documentDate}
                  onChange={(e) =>
                    setSession((current) =>
                      current
                        ? { ...current, documentDate: e.target.value }
                        : current
                    )
                  }
                  className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-[10px] text-muted-foreground">
                  Used for 3-year compliance history organization.
                </p>
              </div>
            </div>

            {session.mode === "authority" && session.authorityDraft && (
              <AuthorityForm
                draft={session.authorityDraft}
                profile={profile}
                onChange={(authorityDraft) =>
                  setSession((current) =>
                    current ? { ...current, authorityDraft } : current
                  )
                }
              />
            )}

            {session.mode === "safety" && session.safetyDraft && (
              <SafetyForm
                draft={session.safetyDraft}
                onChange={(safetyDraft) =>
                  setSession((current) =>
                    current ? { ...current, safetyDraft } : current
                  )
                }
              />
            )}

            {session.mode === "audit" && session.auditDraft && (
              <AuditForm
                draft={session.auditDraft}
                onChange={(auditDraft) =>
                  setSession((current) =>
                    current ? { ...current, auditDraft } : current
                  )
                }
              />
            )}
          </div>

          <div className="flex justify-end border-t border-border p-4 bg-muted/10">
            <button
              type="button"
              disabled={!ready}
              onClick={onSave}
              className="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
            >
              <CheckCircle2 className="mr-2 size-4" />
              Save Record
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   LIST ROWS
========================================================= */

function AuthorityRow({
  record,
  rules,
  selected,
  onClick,
}: {
  record: AuthorityRecord
  rules: DeadlineRules
  selected: boolean
  onClick: () => void
}) {
  const deadline =
    record.authorityType === "MCS150"
      ? record.nextActionDate
      : record.expiryDate

  const deadlineStatus = getDeadlineStatus(deadline, rules)
  const style = getDeadlineClasses(deadlineStatus)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full gap-4 border-l-4 p-4 text-left transition-colors md:grid-cols-12 ${
        style.left
      } ${selected ? "bg-primary/[0.045]" : "hover:bg-muted/25"} ${
        record.isArchived ? "opacity-60 bg-muted/10" : ""
      }`}
    >
      <div className="md:col-span-3">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground">{record.name}</p>
          {record.isArchived && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-muted text-muted-foreground border border-border">
              Archived
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {record.id}
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="select-text font-mono text-xs font-medium text-foreground">
          {record.number || "—"}
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {record.issuingAuthority || "Issuing authority not recorded"}
        </p>
      </div>

      <div className="md:col-span-2">
        <p className="text-xs font-medium text-foreground">{record.jurisdictionLabel}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{record.country}</p>
      </div>

      <div className="md:col-span-2">
        <p className="text-[10px] text-muted-foreground">
          {record.authorityType === "MCS150" ? "Next Action" : "Expiry"}
        </p>
        <p className="mt-1 text-xs font-medium text-foreground">{deadline || "Continuous"}</p>
      </div>

      <div className="flex items-center justify-end md:col-span-2">
        <DeadlineBadge status={deadlineStatus} />
      </div>
    </button>
  )
}

function SafetyRow({
  record,
  selected,
  onClick,
}: {
  record: SafetyRecord
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
        selected ? "bg-primary/[0.045]" : "hover:bg-muted/25"
      } ${record.isArchived ? "opacity-60 bg-muted/10" : ""}`}
    >
      <div className="md:col-span-4">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground">
            {record.system === "CARRIER_PROFILE_CVOR"
              ? "Carrier Profile / CVOR"
              : "SMS Profile"}
          </p>
          {record.isArchived && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-muted text-muted-foreground border border-border">
              Archived
            </span>
          )}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {record.jurisdictionLabel}
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="text-[10px] text-muted-foreground">Review Date</p>
        <p className="mt-1 text-xs font-medium text-foreground">{record.reviewDate}</p>
      </div>

      <div className="md:col-span-5">
        <p className="text-xs text-foreground">{record.summary || "No summary recorded."}</p>
      </div>
    </button>
  )
}

function AuditRow({
  record,
  selected,
  onClick,
}: {
  record: AuditRecord
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
        selected ? "bg-primary/[0.045]" : "hover:bg-muted/25"
      } ${record.isArchived ? "opacity-60 bg-muted/10" : ""}`}
    >
      <div className="md:col-span-3">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground">{record.auditType}</p>
          {record.isArchived && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-muted text-muted-foreground border border-border">
              Archived
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {record.referenceNumber || record.id}
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="text-xs font-medium text-foreground">{record.regulator}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {record.jurisdictionLabel}
        </p>
      </div>

      <div className="md:col-span-2">
        <p className="text-[10px] text-muted-foreground">Due</p>
        <p className="mt-1 text-xs text-foreground">{record.dueDate || "—"}</p>
      </div>

      <div className="md:col-span-2">
        <p className="text-[10px] text-muted-foreground">Completed</p>
        <p className="mt-1 text-xs text-foreground">{record.completedDate || "—"}</p>
      </div>

      <div className="flex justify-end md:col-span-2">
        <span className="px-2 py-0.5 rounded text-xs font-medium border border-border bg-background text-foreground">
          {record.status}
        </span>
      </div>
    </button>
  )
}

/* =========================================================
   SECTIONS
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
  title: string
  description: string
  records: AuthorityRecord[]
  rules: DeadlineRules
  selectedId?: string
  onSelect: (record: AuthorityRecord) => void
  onScan: () => void
  onManual: () => void
}) {
  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
      <div className="border-b border-border bg-muted/20 px-5 py-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onScan}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <ScanDocumentIcon size={14} />
              <span className="ml-1.5">Scan Document</span>
            </button>
            <button
              type="button"
              onClick={onManual}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
            >
              <Plus className="mr-1.5 size-3.5" />
              Add Record
            </button>
          </div>
        </div>
      </div>

      <div>
        {records.length === 0 ? (
          <div className="p-10 text-center">
            <Landmark className="mx-auto size-9 text-muted-foreground/30" />
            <p className="mt-3 text-sm font-medium text-foreground">No records found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {records.map((record) => (
              <div key={record.id}>
                <AuthorityRow
                  record={record}
                  rules={rules}
                  selected={selectedId === record.id}
                  onClick={() => onSelect(record)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SafetySection({
  title,
  records,
  selected,
  onSelect,
  onScan,
  onManual,
}: {
  title: string
  records: SafetyRecord[]
  selected: SelectedRecord | null
  onSelect: (record: SafetyRecord) => void
  onScan: () => void
  onManual: () => void
}) {
  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
      <div className="border-b border-border bg-muted/20 px-5 py-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              High-level safety profile snapshots and ratings.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onScan}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <ScanDocumentIcon size={14} />
              <span className="ml-1.5">Scan Document</span>
            </button>
            <button
              type="button"
              onClick={onManual}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
            >
              <Plus className="mr-1.5 size-3.5" />
              Add Snapshot
            </button>
          </div>
        </div>
      </div>

      <div>
        {records.length === 0 ? (
          <div className="p-10 text-center">
            <ShieldCheck className="mx-auto size-9 text-muted-foreground/30" />
            <p className="mt-3 text-sm font-medium text-foreground">No safety snapshot found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {records.map((record) => (
              <div key={record.id}>
                <SafetyRow
                  record={record}
                  selected={
                    selected?.kind === "safety" && selected.record.id === record.id
                  }
                  onClick={() => onSelect(record)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* =========================================================
   EVIDENCE ATTACHMENTS LIST
========================================================= */

function EvidenceHistory({
  evidence,
  onPreview,
}: {
  evidence: AuthorityEvidence[]
  onPreview: (evidence: AuthorityEvidence) => void
}) {
  const [showOlder, setShowOlder] = useState(false)

  const sorted = [...evidence].sort((a, b) =>
    (b.documentDate || b.uploadedAt).localeCompare(a.documentDate || a.uploadedAt)
  )

  const recent = sorted.filter((item) =>
    isDateInsideThreeYears(item.documentDate || item.uploadedAt)
  )

  const older = sorted.filter(
    (item) => !isDateInsideThreeYears(item.documentDate || item.uploadedAt)
  )

  const visible = showOlder ? sorted : recent

  return (
    <section className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Attached Documents & 3-Year Vault
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Original supporting certificates and filings.
          </p>
        </div>

        {older.length > 0 && (
          <button
            type="button"
            onClick={() => setShowOlder((current) => !current)}
            className="inline-flex items-center h-7 px-2 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted/50 transition-colors"
          >
            <History className="mr-1 size-3" />
            {showOlder ? "Standard View" : `Older History (${older.length})`}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No supporting documents attached.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPreview(item)}
              className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.025]"
            >
              <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{item.fileName}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {item.documentDate || item.uploadedAt.slice(0, 10)}
                  {item.ocrConfidence !== undefined &&
                    ` · OCR ${item.ocrConfidence}%`}
                </p>
              </div>
              <span className="text-[10px] font-semibold text-primary">Preview</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/* =========================================================
   INSPECTOR (VIEW = RECORD)
========================================================= */

function RecordInspector({
  selected,
  evidence,
  rules,
  onClose,
  onEdit,
  onArchive,
  onRestore,
  onPreview,
}: {
  selected: SelectedRecord | null
  evidence: AuthorityEvidence[]
  rules: DeadlineRules
  onClose: () => void
  onEdit: () => void
  onArchive: () => void
  onRestore: () => void
  onPreview: (evidence: AuthorityEvidence) => void
}) {
  if (!selected) {
    return (
      <div className="border border-dashed border-border rounded-xl bg-card p-10 flex min-h-[520px] flex-col items-center justify-center text-center">
        <Landmark className="size-10 text-muted-foreground/30" />
        <p className="mt-4 text-sm font-medium text-foreground">Select a record</p>
        <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted-foreground">
          Click any row to inspect regulatory identifiers, dates, and attached compliance documents.
        </p>
      </div>
    )
  }

  const record = selected.record
  const attached = evidence.filter((item) => record.evidenceIds.includes(item.id))

  const title =
    selected.kind === "authority"
      ? selected.record.name
      : selected.kind === "safety"
      ? selected.record.system === "CARRIER_PROFILE_CVOR"
        ? "Carrier Profile / CVOR"
        : "SMS Profile"
      : selected.record.auditType

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
      <div className="border-b border-border bg-primary/[0.03] px-5 py-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground truncate">{title}</h3>
            {record.isArchived && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                Archived
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {record.id}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="size-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-4 p-5">
        {selected.kind === "authority" && (
          <>
            <ReadOnlyField
              label="Registration Number"
              value={selected.record.number}
              copyable
              mono
            />

            <ReadOnlyField
              label="Issuing Authority"
              value={selected.record.issuingAuthority}
            />

            <ReadOnlyField
              label="Jurisdiction"
              value={selected.record.jurisdictionLabel}
            />

            <ReadOnlyField
              label="Country"
              value={selected.record.country}
            />

            <ReadOnlyField
              label="Status"
              value={selected.record.status}
              badge={
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold border border-border bg-muted/40 text-foreground">
                  {selected.record.status}
                </span>
              }
            />

            {selected.record.authorityType === "MCS150" ? (
              <>
                <ReadOnlyField
                  label="Filed / Update Date"
                  value={selected.record.eventDate}
                />

                <ReadOnlyField
                  label="Next Action Deadline"
                  value={selected.record.nextActionDate}
                  badge={
                    <DeadlineBadge
                      status={getDeadlineStatus(
                        selected.record.nextActionDate,
                        rules
                      )}
                    />
                  }
                />
              </>
            ) : (
              <>
                <ReadOnlyField
                  label="Issue Date"
                  value={selected.record.issueDate}
                />

                <ReadOnlyField
                  label="Effective Date"
                  value={selected.record.effectiveDate}
                />

                <ReadOnlyField
                  label="Expiry Date"
                  value={selected.record.expiryDate || "Continuous"}
                  badge={
                    <DeadlineBadge
                      status={getDeadlineStatus(
                        selected.record.expiryDate,
                        rules
                      )}
                    />
                  }
                />
              </>
            )}

            {selected.record.notes && (
              <ReadOnlyField label="Notes" value={selected.record.notes} />
            )}
          </>
        )}

        {selected.kind === "safety" && (
          <>
            <ReadOnlyField
              label="Jurisdiction"
              value={selected.record.jurisdictionLabel}
            />

            <ReadOnlyField
              label="Country"
              value={selected.record.country}
            />

            <ReadOnlyField
              label="Review Date"
              value={selected.record.reviewDate}
            />

            <ReadOnlyField
              label="Summary"
              value={selected.record.summary}
            />

            {selected.record.notes && (
              <ReadOnlyField label="Notes" value={selected.record.notes} />
            )}
          </>
        )}

        {selected.kind === "audit" && (
          <>
            <ReadOnlyField
              label="Regulator"
              value={selected.record.regulator}
            />

            <ReadOnlyField
              label="Jurisdiction"
              value={selected.record.jurisdictionLabel}
            />

            <ReadOnlyField
              label="Reference"
              value={selected.record.referenceNumber}
              copyable
              mono
            />

            <ReadOnlyField
              label="Notice Date"
              value={selected.record.noticeDate}
            />

            <ReadOnlyField
              label="Due Date"
              value={selected.record.dueDate}
            />

            <ReadOnlyField
              label="Completed Date"
              value={selected.record.completedDate}
            />

            <ReadOnlyField
              label="Status"
              value={selected.record.status}
              badge={
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold border border-border bg-muted/40 text-foreground">
                  {selected.record.status}
                </span>
              }
            />

            <ReadOnlyField
              label="Outcome"
              value={selected.record.outcome}
            />

            <ReadOnlyField
              label="Score / Rating"
              value={selected.record.score}
            />

            {selected.record.notes && (
              <ReadOnlyField label="Notes" value={selected.record.notes} />
            )}
          </>
        )}

        <EvidenceHistory evidence={attached} onPreview={onPreview} />

        <div className="flex gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 inline-flex items-center justify-center px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
          >
            <Pencil className="mr-1.5 size-3.5" />
            Edit
          </button>

          {record.isArchived ? (
            <button
              type="button"
              onClick={onRestore}
              className="flex-1 inline-flex items-center justify-center px-3 py-2 text-xs font-semibold rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              <ArchiveRestore className="mr-1.5 size-3.5" />
              Restore
            </button>
          ) : (
            <button
              type="button"
              onClick={onArchive}
              className="flex-1 inline-flex items-center justify-center px-3 py-2 text-xs font-semibold rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
            >
              <Archive className="mr-1.5 size-3.5" />
              Archive
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   MAIN COMPONENT
========================================================= */

export default function AuthoritiesPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string

  const deviceInputRef = useRef<HTMLInputElement | null>(null)

  const [company, setCompany] = useState<Company | null>(null)
  const [data, setData] = useState<StoredAuthoritiesData>(EMPTY_DATA)
  const [rules, setRules] = useState<DeadlineRules>(DEFAULT_DEADLINE_RULES)
  const [loading, setLoading] = useState(true)
  const [showOlderHistory, setShowOlderHistory] = useState(false)
  const [selected, setSelected] = useState<SelectedRecord | null>(null)
  const [previewEvidence, setPreviewEvidence] = useState<AuthorityEvidence | null>(null)
  const [manualState, setManualState] = useState<ManualState | null>(null)
  const [editingState, setEditingState] = useState<ManualState | null>(null)
  const [archiveConfirm, setArchiveConfirm] = useState<SelectedRecord | null>(null)
  const [archiveReasonInput, setArchiveReasonInput] = useState("")

  const [sourceContext, setSourceContext] = useState<{
    mode: "authority" | "safety" | "audit"
    category?: AuthorityCategory
    authorityType?: AuthorityType
    safetySystem?: SafetySystem
  } | null>(null)

  const [showCamera, setShowCamera] = useState(false)
  const [ocrSession, setOcrSession] = useState<OCRSession | null>(null)

  const storageKey = `tes_company_authorities_${companyId}`

  /* =======================================================
     LOAD INITIAL STATE
  ======================================================= */

  useEffect(() => {
    try {
      const companies = getCompanies()
      const found = companies.find((item) => item.id === companyId)
      setCompany(found || null)

      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        setData({
          ...EMPTY_DATA,
          ...parsed,
          authorities: Array.isArray(parsed.authorities) ? parsed.authorities : [],
          safety: Array.isArray(parsed.safety) ? parsed.safety : [],
          audits: Array.isArray(parsed.audits) ? parsed.audits : [],
          evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
        })
      }

      setRules(loadDeadlineRules())
    } catch (error) {
      console.error("Unable to load Authorities data:", error)
    } finally {
      setLoading(false)
    }
  }, [companyId, storageKey])

  const profile = useMemo(
    () => (company ? deriveAuthorityProfile(company) : null),
    [company]
  )

  /* =======================================================
     COMPANY MASTER SYNCHRONIZATION HELPER
  ======================================================= */

  const syncToCompanyMaster = (
    authorityType: AuthorityType,
    number: string
  ): boolean => {
    // Only these four authority types map to company master fields
    const mappedTypes: AuthorityType[] = [
      "USDOT",
      "MC",
      "PROVINCIAL_CARRIER_IDENTIFIER",
      "CANADIAN_SAFETY_AUTHORITY",
    ]

    if (!mappedTypes.includes(authorityType)) {
      return true
    }

    const companies = getCompanies()
    const index = companies.findIndex((c) => c.id === companyId)
    if (index === -1) {
      throw new Error(`Company ${companyId} not found for master synchronization`)
    }

    const updated = { ...companies[index] }
    let mutated = false

    if (authorityType === "USDOT") {
      updated.usdot = normalizeUSDOT(number)
      mutated = true
    } else if (authorityType === "MC") {
      updated.mc = normalizeMC(number)
      mutated = true
    } else if (authorityType === "PROVINCIAL_CARRIER_IDENTIFIER") {
      updated.mvid = normalizeTaxId(number)
      mutated = true
    } else if (authorityType === "CANADIAN_SAFETY_AUTHORITY") {
      updated.nsc = normalizeTaxId(number)
      mutated = true
    }

    if (mutated) {
      companies[index] = updated
      localStorage.setItem("tes_companies", JSON.stringify(companies))
      setCompany(updated)
    }

    return true
  }

  /* =======================================================
     EXPLICIT PERSISTENCE HELPER
  ======================================================= */

  const persistAuthoritiesData = (newData: StoredAuthoritiesData) => {
    localStorage.setItem(storageKey, JSON.stringify(newData))
    setData(newData)
  }

  /* =======================================================
     3-YEAR RECORD FILTERING
  ======================================================= */

  const filteredAuthorities = data.authorities.filter(
    (record) =>
      showOlderHistory || isDateInsideThreeYears(authorityReferenceDate(record))
  )

  const filteredSafety = data.safety.filter(
    (record) =>
      showOlderHistory || isDateInsideThreeYears(safetyReferenceDate(record))
  )

  const filteredAudits = data.audits.filter(
    (record) =>
      showOlderHistory || isDateInsideThreeYears(auditReferenceDate(record))
  )

  const olderRecordCount = [
    ...data.authorities.filter(
      (record) => !isDateInsideThreeYears(authorityReferenceDate(record))
    ),
    ...data.safety.filter(
      (record) => !isDateInsideThreeYears(safetyReferenceDate(record))
    ),
    ...data.audits.filter(
      (record) => !isDateInsideThreeYears(auditReferenceDate(record))
    ),
  ].length

  const categoryAuthorities = (category: AuthorityCategory) =>
    filteredAuthorities.filter((record) => record.category === category)

  /* =======================================================
     SAVE AUTHORITY
  ======================================================= */

  const saveAuthority = (
    draft: AuthorityDraft,
    source: SourceType,
    evidence?: AuthorityEvidence,
    editingId?: string
  ) => {
    const snapshot = captureCrossStoreSnapshot(companyId)

    const conflict = findGlobalAuthorityConflict({
      currentCompanyId: companyId,
      authorityType: draft.authorityType,
      number: draft.number,
      editingId,
    })

    if (conflict) {
      rollbackCrossStoreSnapshot(companyId, snapshot)
      if (conflict.sameCompany) {
        alert(
          `This identifier already exists for this company.\n\nOpen the existing ${draft.name} record instead of creating a duplicate.`
        )
      } else {
        alert(
          `Duplicate identifier conflict.\n\n${draft.name} ${draft.number} is already connected to ${conflict.companyName} (${conflict.companyId}). TES will not create a second authoritative record.`
        )
      }
      return false
    }

    const now = isoNow()

    try {
      if (editingId) {
        const updatedAuthorities = data.authorities.map((record) =>
          record.id === editingId
            ? {
                ...record,
                ...draft,
                evidenceIds: evidence
                  ? Array.from(new Set([...record.evidenceIds, evidence.id]))
                  : record.evidenceIds,
                source,
                updatedAt: now,
              }
            : record
        )

        const updatedEvidence = evidence
          ? [{ ...evidence, recordId: editingId }, ...data.evidence]
          : data.evidence

        const newData: StoredAuthoritiesData = {
          ...data,
          authorities: updatedAuthorities,
          evidence: updatedEvidence,
        }

        // Commit Authorities store
        persistAuthoritiesData(newData)

        // Commit Company Master store
        syncToCompanyMaster(draft.authorityType, draft.number)

        recordAuditEvent({
          actor: "Safety Director",
          role: "Compliance Officer",
          companyId,
          entityType: "Authority",
          entityId: editingId,
          action: "UPDATE",
          details: `Updated authority record ${draft.name} (${draft.number})`,
          newValue: JSON.stringify({ number: draft.number, status: draft.status }),
          evidenceId: evidence?.id,
        })

        return true
      }

      const newId = createId("AUTH")
      const record: AuthorityRecord = {
        id: newId,
        ...draft,
        evidenceIds: evidence ? [evidence.id] : [],
        source,
        createdAt: now,
        updatedAt: now,
      }

      const newData: StoredAuthoritiesData = {
        ...data,
        authorities: [record, ...data.authorities],
        evidence: evidence
          ? [{ ...evidence, recordId: record.id }, ...data.evidence]
          : data.evidence,
      }

      // Commit Authorities store
      persistAuthoritiesData(newData)

      // Commit Company Master store
      syncToCompanyMaster(draft.authorityType, draft.number)

      recordAuditEvent({
        actor: "Safety Director",
        role: "Compliance Officer",
        companyId,
        entityType: "Authority",
        entityId: newId,
        action: "CREATE",
        details: `Created new authority record ${draft.name} (${draft.number})`,
        newValue: JSON.stringify({ number: draft.number, status: draft.status }),
        evidenceId: evidence?.id,
      })

      setSelected({
        kind: "authority",
        record,
      })

      return true
    } catch (err) {
      console.error("Failed atomic transaction during authority save; rolling back:", err)
      rollbackCrossStoreSnapshot(companyId, snapshot)
      // Restore React states from pre-operation snapshot
      try {
        if (snapshot.authorities) {
          setData(JSON.parse(snapshot.authorities))
        }
        if (snapshot.companies) {
          const companies = JSON.parse(snapshot.companies)
          const found = companies.find((c: Company) => c.id === companyId)
          if (found) setCompany(found)
        }
      } catch (parseErr) {
        console.error("Failed to parse snapshot during rollback:", parseErr)
      }
      alert("Failed to save authority record. Changes have been rolled back to maintain consistency.")
      return false
    }
  }

  /* =======================================================
     SAVE SAFETY
  ======================================================= */

  const saveSafety = (
    draft: SafetyDraft,
    source: SourceType,
    evidence?: AuthorityEvidence,
    editingId?: string
  ) => {
    const now = isoNow()

    if (editingId) {
      const updatedSafety = data.safety.map((record) =>
        record.id === editingId
          ? {
              ...record,
              ...draft,
              evidenceIds: evidence
                ? Array.from(new Set([...record.evidenceIds, evidence.id]))
                : record.evidenceIds,
              source,
              updatedAt: now,
            }
          : record
      )

      const updatedEvidence = evidence
        ? [{ ...evidence, recordId: editingId }, ...data.evidence]
        : data.evidence

      const newData: StoredAuthoritiesData = {
        ...data,
        safety: updatedSafety,
        evidence: updatedEvidence,
      }

      persistAuthoritiesData(newData)

      recordAuditEvent({
        actor: "Safety Director",
        role: "Compliance Officer",
        companyId,
        entityType: "Authority",
        entityId: editingId,
        action: "UPDATE",
        details: `Updated safety profile snapshot ${draft.system}`,
        evidenceId: evidence?.id,
      })

      return
    }

    const newId = createId("SAFE")
    const record: SafetyRecord = {
      id: newId,
      ...draft,
      evidenceIds: evidence ? [evidence.id] : [],
      source,
      createdAt: now,
      updatedAt: now,
    }

    const newData: StoredAuthoritiesData = {
      ...data,
      safety: [record, ...data.safety],
      evidence: evidence
        ? [{ ...evidence, recordId: record.id }, ...data.evidence]
        : data.evidence,
    }

    persistAuthoritiesData(newData)

    recordAuditEvent({
      actor: "Safety Director",
      role: "Compliance Officer",
      companyId,
      entityType: "Authority",
      entityId: newId,
      action: "CREATE",
      details: `Created new safety profile snapshot ${draft.system}`,
      evidenceId: evidence?.id,
    })

    setSelected({
      kind: "safety",
      record,
    })
  }

  /* =======================================================
     SAVE AUDIT
  ======================================================= */

  const saveAudit = (
    draft: AuditDraft,
    source: SourceType,
    evidence?: AuthorityEvidence,
    editingId?: string
  ) => {
    const now = isoNow()

    if (editingId) {
      const updatedAudits = data.audits.map((record) =>
        record.id === editingId
          ? {
              ...record,
              ...draft,
              evidenceIds: evidence
                ? Array.from(new Set([...record.evidenceIds, evidence.id]))
                : record.evidenceIds,
              source,
              updatedAt: now,
            }
          : record
      )

      const updatedEvidence = evidence
        ? [{ ...evidence, recordId: editingId }, ...data.evidence]
        : data.evidence

      const newData: StoredAuthoritiesData = {
        ...data,
        audits: updatedAudits,
        evidence: updatedEvidence,
      }

      persistAuthoritiesData(newData)

      recordAuditEvent({
        actor: "Safety Director",
        role: "Compliance Officer",
        companyId,
        entityType: "Authority",
        entityId: editingId,
        action: "UPDATE",
        details: `Updated regulatory audit record ${draft.auditType} (${draft.regulator})`,
        evidenceId: evidence?.id,
      })

      return
    }

    const newId = createId("AUD")
    const record: AuditRecord = {
      id: newId,
      ...draft,
      evidenceIds: evidence ? [evidence.id] : [],
      source,
      createdAt: now,
      updatedAt: now,
    }

    const newData: StoredAuthoritiesData = {
      ...data,
      audits: [record, ...data.audits],
      evidence: evidence
        ? [{ ...evidence, recordId: record.id }, ...data.evidence]
        : data.evidence,
    }

    persistAuthoritiesData(newData)

    recordAuditEvent({
      actor: "Safety Director",
      role: "Compliance Officer",
      companyId,
      entityType: "Authority",
      entityId: newId,
      action: "CREATE",
      details: `Created new regulatory audit record ${draft.auditType} (${draft.regulator})`,
      evidenceId: evidence?.id,
    })

    setSelected({
      kind: "audit",
      record,
    })
  }

  /* =======================================================
     SOFT ARCHIVE & RESTORE
  ======================================================= */

  const confirmArchive = () => {
    if (!archiveConfirm) return

    const now = isoNow()
    const id = archiveConfirm.record.id
    const reason = archiveReasonInput.trim() || "Archived by operator"

    let updatedAuthorities = data.authorities
    let updatedSafety = data.safety
    let updatedAudits = data.audits

    if (archiveConfirm.kind === "authority") {
      updatedAuthorities = data.authorities.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: true,
              status: "Archived" as const,
              archivedAt: now,
              archivedBy: "Safety Director",
              archiveReason: reason,
              updatedAt: now,
            }
          : record
      )
    } else if (archiveConfirm.kind === "safety") {
      updatedSafety = data.safety.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: true,
              archivedAt: now,
              archivedBy: "Safety Director",
              archiveReason: reason,
              updatedAt: now,
            }
          : record
      )
    } else if (archiveConfirm.kind === "audit") {
      updatedAudits = data.audits.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: true,
              archivedAt: now,
              archivedBy: "Safety Director",
              archiveReason: reason,
              updatedAt: now,
            }
          : record
      )
    }

    const newData: StoredAuthoritiesData = {
      ...data,
      authorities: updatedAuthorities,
      safety: updatedSafety,
      audits: updatedAudits,
    }

    persistAuthoritiesData(newData)

    recordAuditEvent({
      actor: "Safety Director",
      role: "Compliance Officer",
      companyId,
      entityType: "Authority",
      entityId: id,
      action: "ARCHIVE",
      details: `Soft-archived ${archiveConfirm.kind} record ${id}: ${reason}`,
    })

    setArchiveConfirm(null)
    setArchiveReasonInput("")
    setSelected(null)
  }

  const handleRestore = () => {
    if (!selected) return

    const now = isoNow()
    const id = selected.record.id

    // Requirement 1: If restoring an AuthorityRecord, check global uniqueness before unarchiving
    if (selected.kind === "authority") {
      const conflict = findGlobalAuthorityConflict({
        currentCompanyId: companyId,
        authorityType: selected.record.authorityType,
        number: selected.record.number,
        editingId: selected.record.id,
      })

      if (conflict) {
        if (conflict.sameCompany) {
          alert(
            `This identifier already exists for this company.\n\nAn active ${selected.record.name} record already uses this identifier. TES cannot restore this duplicate record.`
          )
        } else {
          alert(
            `Duplicate identifier conflict.\n\n${selected.record.name} ${selected.record.number} is currently active in ${conflict.companyName} (${conflict.companyId}). TES will not restore a conflicting authoritative record.`
          )
        }
        return
      }
    }

    const snapshot = captureCrossStoreSnapshot(companyId)

    let updatedAuthorities = data.authorities
    let updatedSafety = data.safety
    let updatedAudits = data.audits

    if (selected.kind === "authority") {
      updatedAuthorities = data.authorities.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: false,
              status: "Active" as const,
              updatedAt: now,
            }
          : record
      )
    } else if (selected.kind === "safety") {
      updatedSafety = data.safety.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: false,
              updatedAt: now,
            }
          : record
      )
    } else if (selected.kind === "audit") {
      updatedAudits = data.audits.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: false,
              updatedAt: now,
            }
          : record
      )
    }

    const newData: StoredAuthoritiesData = {
      ...data,
      authorities: updatedAuthorities,
      safety: updatedSafety,
      audits: updatedAudits,
    }

    try {
      // Commit Authorities store
      persistAuthoritiesData(newData)

      // Requirement 3: If restoring an authority record, synchronize active identifier to company master
      if (selected.kind === "authority") {
        syncToCompanyMaster(selected.record.authorityType, selected.record.number)
      }

      recordAuditEvent({
        actor: "Safety Director",
        role: "Compliance Officer",
        companyId,
        entityType: "Authority",
        entityId: id,
        action: "RESTORE",
        details: `Restored ${selected.kind} record ${id}`,
      })

      setSelected((current) =>
        current
          ? {
              ...current,
              record: {
                ...current.record,
                isArchived: false,
                status: selected.kind === "authority" ? "Active" : (current.record as any).status,
                updatedAt: now,
              } as any,
            }
          : null
      )
    } catch (err) {
      console.error("Failed atomic transaction during record restore; rolling back:", err)
      rollbackCrossStoreSnapshot(companyId, snapshot)
      // Restore React states from pre-operation snapshot
      try {
        if (snapshot.authorities) {
          setData(JSON.parse(snapshot.authorities))
        }
        if (snapshot.companies) {
          const companies = JSON.parse(snapshot.companies)
          const found = companies.find((c: Company) => c.id === companyId)
          if (found) setCompany(found)
        }
      } catch (parseErr) {
        console.error("Failed to parse snapshot during rollback:", parseErr)
      }
      alert("Failed to restore record. Changes have been rolled back to maintain consistency.")
    }
  }

  /* =======================================================
     EDIT HANDLER
  ======================================================= */

  const openEdit = () => {
    if (!selected) return

    if (selected.kind === "authority") {
      const record = selected.record
      setEditingState({
        mode: "authority",
        draft: {
          category: record.category,
          authorityType: record.authorityType,
          name: record.name,
          number: record.number,
          issuingAuthority: record.issuingAuthority,
          jurisdictionCode: record.jurisdictionCode,
          jurisdictionLabel: record.jurisdictionLabel,
          country: record.country,
          status: record.status,
          issueDate: record.issueDate || "",
          effectiveDate: record.effectiveDate || "",
          expiryDate: record.expiryDate || "",
          eventDate: record.eventDate || "",
          nextActionDate: record.nextActionDate || "",
          notes: record.notes || "",
        },
      })
      return
    }

    if (selected.kind === "safety") {
      const record = selected.record
      setEditingState({
        mode: "safety",
        draft: {
          system: record.system,
          jurisdictionCode: record.jurisdictionCode,
          jurisdictionLabel: record.jurisdictionLabel,
          country: record.country,
          reviewDate: record.reviewDate,
          summary: record.summary,
          notes: record.notes || "",
        },
      })
      return
    }

    const record = selected.record
    setEditingState({
      mode: "audit",
      draft: {
        auditType: record.auditType,
        regulator: record.regulator,
        jurisdictionCode: record.jurisdictionCode,
        jurisdictionLabel: record.jurisdictionLabel,
        country: record.country,
        referenceNumber: record.referenceNumber,
        noticeDate: record.noticeDate || "",
        dueDate: record.dueDate || "",
        completedDate: record.completedDate || "",
        status: record.status,
        outcome: record.outcome || "",
        score: record.score || "",
        followUpRequired: record.followUpRequired,
        followUpDueDate: record.followUpDueDate || "",
        notes: record.notes || "",
      },
    })
  }

  /* =======================================================
     START OCR FILE
  ======================================================= */

  const startOCRFile = async (file: File, source: DocumentSource) => {
    if (!sourceContext || !company || !profile) return

    if (
      !file.type.startsWith("image/") &&
      file.type !== "application/pdf"
    ) {
      alert("Please select a PDF or image.")
      return
    }

    const dataUrl = await readFileAsDataUrl(file)

    if (sourceContext.mode === "authority") {
      const category = sourceContext.category!
      const options = authorityOptions(category, profile)
      const type = sourceContext.authorityType || options[0]?.value || "OTHER"

      setOcrSession({
        mode: "authority",
        source,
        file,
        dataUrl,
        processing: false,
        extractionComplete: false,
        documentDate: todayISO(),
        authorityDraft: emptyAuthorityDraft(company, category, type),
      })
    } else if (sourceContext.mode === "safety") {
      setOcrSession({
        mode: "safety",
        source,
        file,
        dataUrl,
        processing: false,
        extractionComplete: false,
        documentDate: todayISO(),
        safetyDraft: emptySafetyDraft(company, sourceContext.safetySystem!),
      })
    } else {
      setOcrSession({
        mode: "audit",
        source,
        file,
        dataUrl,
        processing: false,
        extractionComplete: false,
        documentDate: todayISO(),
        auditDraft: emptyAuditDraft(company),
      })
    }

    setSourceContext(null)
  }

  /* =======================================================
     SAVE OCR SESSION
  ======================================================= */

  const saveOCR = () => {
    if (!ocrSession) return

    const evidence: AuthorityEvidence = {
      id: createId("DOC"),
      fileName: ocrSession.file.name,
      mimeType: ocrSession.file.type,
      dataUrl: ocrSession.dataUrl,
      documentDate: ocrSession.documentDate,
      uploadedAt: isoNow(),
      source: ocrSession.source,
      ocrConfidence: ocrSession.confidence,
    }

    if (ocrSession.mode === "authority" && ocrSession.authorityDraft) {
      const saved = saveAuthority(ocrSession.authorityDraft, "OCR", evidence)
      if (saved) {
        setOcrSession(null)
      }
      return
    }

    if (ocrSession.mode === "safety" && ocrSession.safetyDraft) {
      saveSafety(ocrSession.safetyDraft, "OCR", evidence)
      setOcrSession(null)
      return
    }

    if (ocrSession.mode === "audit" && ocrSession.auditDraft) {
      saveAudit(ocrSession.auditDraft, "OCR", evidence)
      setOcrSession(null)
    }
  }

  /* =======================================================
     PREVIEW DOCUMENT HELPER WITH AUDIT
  ======================================================= */

  const handlePreviewDocument = (doc: AuthorityEvidence) => {
    setPreviewEvidence(doc)
    recordAuditEvent({
      actor: "Safety Director",
      role: "Compliance Officer",
      companyId,
      entityType: "Evidence",
      entityId: doc.id,
      action: "VIEW_DOCUMENT",
      details: `Viewed document ${doc.fileName}`,
      evidenceId: doc.id,
    })
  }

  /* =======================================================
     LOADING / NOT FOUND STATES
  ======================================================= */

  if (loading) {
    return <LoadingState message="Loading authorities and regulatory registrations..." />
  }

  if (!company || !profile) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Building2 className="size-10 text-muted-foreground/40" />
        <h2 className="text-lg font-semibold text-foreground">Company Not Found</h2>
        <button
          type="button"
          onClick={() => router.push("/companies")}
          className="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
        >
          <ArrowLeft className="mr-2 size-4" />
          Companies
        </button>
      </div>
    )
  }

  /* =======================================================
     SUMMARY METRICS
  ======================================================= */

  const deadlineStatuses = filteredAuthorities
    .filter((r) => !r.isArchived)
    .map((record) =>
      getDeadlineStatus(
        record.authorityType === "MCS150"
          ? record.nextActionDate
          : record.expiryDate,
        rules
      )
    )

  const countStatus = (status: DeadlineStatus) =>
    deadlineStatuses.filter((item) => item === status).length

  const registrations = categoryAuthorities("operating_registration").filter(
    (record) => {
      if (record.authorityType === "PHMSA") {
        return profile.showPHMSA
      }
      if (record.authorityType === "UCR") {
        return profile.showUCR
      }
      return true
    }
  )

  const showOperatingRegistrations = profile.showUCR || profile.showPHMSA

  return (
    <>
      <div className="flex max-w-[1600px] flex-col gap-6 pb-12">
        {/* HEADER */}
        <div>
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => router.push(`/companies/${company.id}/profile`)}
              className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <ArrowLeft className="size-4" />
            </button>

            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Operating Authorities & Registrations
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {company.name}{" "}
                <span className="font-mono text-xs">({company.id})</span>
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Registered Origin
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {company.regCorpState || "Unknown"},{" "}
                  {company.regCorpCountry || "Unknown"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Operating Region
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {company.region || "Not specified"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Cargo / Hazmat Trigger
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {profile.hazmat ? "Hazmat Operation" : "No Hazmat Trigger"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border lg:block" />

              <button
                type="button"
                onClick={() => setRules(loadDeadlineRules())}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <RefreshCcw className="size-3" />
                Refresh Deadline Settings
              </button>
            </div>
          </div>
        </div>

        {/* DEADLINE CARDS */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(
            [
              "Healthy",
              "Watch",
              "Urgent",
              "Critical",
              "Expired",
            ] as DeadlineStatus[]
          ).map((status) => {
            const style = getDeadlineClasses(status)
            return (
              <div key={status} className={`border border-border rounded-xl bg-card p-4 border-l-4 ${style.left} shadow-sm`}>
                <p className="text-xs text-muted-foreground">{status}</p>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <p className="text-2xl font-bold text-foreground">{countStatus(status)}</p>
                  <DeadlineBadge status={status} />
                </div>
              </div>
            )
          })}
        </div>

        {/* 3-YEAR RETENTION BANNER */}
        <div className="border border-primary/15 rounded-xl bg-primary/[0.025] p-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <History className="mt-0.5 size-4 text-primary shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Standard 3-Year Operational Retention Window
                </p>
                <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                  The primary view displays active and recent records within the 3-year compliance window. Older retained records remain safely accessible.
                </p>
              </div>
            </div>

            {olderRecordCount > 0 && (
              <button
                type="button"
                onClick={() => setShowOlderHistory((current) => !current)}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors shrink-0"
              >
                <History className="mr-1.5 size-3.5" />
                {showOlderHistory
                  ? "Show Standard View"
                  : `Show Older History (${olderRecordCount})`}
              </button>
            )}
          </div>
        </div>

        {/* MAIN SPLIT LAYOUT */}
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-6">
            {/* CANADIAN OPERATIONS */}
            {profile.showCanadian && (
              <AuthoritySection
                title="Canadian Operations"
                description="Provincial carrier identifier (MVID / RIN) and NSC / Safety Fitness Certificate / CVOR records."
                records={categoryAuthorities("canadian")}
                rules={rules}
                selectedId={
                  selected?.kind === "authority"
                    ? selected.record.id
                    : undefined
                }
                onSelect={(record) =>
                  setSelected({
                    kind: "authority",
                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode: "authority",
                    category: "canadian",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode: "authority",
                    draft: emptyAuthorityDraft(company, "canadian"),
                  })
                }
              />
            )}

            {/* US FEDERAL OPERATIONS */}
            {profile.showUS && (
              <AuthoritySection
                title="US Federal Operations"
                description="USDOT identifier, MC operating authority, and MCS-150 biennial update filings."
                records={categoryAuthorities("us_federal")}
                rules={rules}
                selectedId={
                  selected?.kind === "authority"
                    ? selected.record.id
                    : undefined
                }
                onSelect={(record) =>
                  setSelected({
                    kind: "authority",
                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode: "authority",
                    category: "us_federal",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode: "authority",
                    draft: emptyAuthorityDraft(company, "us_federal"),
                  })
                }
              />
            )}

            {/* OPERATING REGISTRATIONS (UCR & PHMSA) */}
            {showOperatingRegistrations && (
              <AuthoritySection
                title="Operating Registrations"
                description={
                  profile.showPHMSA
                    ? "Unified Carrier Registration (UCR) and fleet PHMSA hazardous material registrations."
                    : "Carrier-level operating registrations including UCR."
                }
                records={registrations}
                rules={rules}
                selectedId={
                  selected?.kind === "authority"
                    ? selected.record.id
                    : undefined
                }
                onSelect={(record) =>
                  setSelected({
                    kind: "authority",
                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode: "authority",
                    category: "operating_registration",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode: "authority",
                    draft: emptyAuthorityDraft(
                      company,
                      "operating_registration",
                      profile.showUCR ? "UCR" : "PHMSA"
                    ),
                  })
                }
              />
            )}

            {/* CANADIAN SAFETY SNAPSHOT */}
            {profile.showCarrierProfile && (
              <SafetySection
                title="Carrier Profile / CVOR"
                records={filteredSafety.filter(
                  (record) => record.system === "CARRIER_PROFILE_CVOR"
                )}
                selected={selected}
                onSelect={(record) =>
                  setSelected({
                    kind: "safety",
                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode: "safety",
                    safetySystem: "CARRIER_PROFILE_CVOR",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode: "safety",
                    draft: emptySafetyDraft(company, "CARRIER_PROFILE_CVOR"),
                  })
                }
              />
            )}

            {/* US SMS PROFILE SNAPSHOT */}
            {profile.showSMSProfile && (
              <SafetySection
                title="SMS Safety Profile"
                records={filteredSafety.filter(
                  (record) => record.system === "SMS_PROFILE"
                )}
                selected={selected}
                onSelect={(record) =>
                  setSelected({
                    kind: "safety",
                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode: "safety",
                    safetySystem: "SMS_PROFILE",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode: "safety",
                    draft: emptySafetyDraft(company, "SMS_PROFILE"),
                  })
                }
              />
            )}

            {/* AUDITS & INTERVENTIONS */}
            <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
              <div className="border-b border-border bg-muted/20 px-5 py-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Audits & Interventions</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Regulatory notices, investigations, interventions, and outcomes.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSourceContext({
                          mode: "audit",
                        })
                      }
                      className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                    >
                      <ScanDocumentIcon size={14} />
                      <span className="ml-1.5">Scan Notice</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setManualState({
                          mode: "audit",
                          draft: emptyAuditDraft(company),
                        })
                      }
                      className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
                    >
                      <Plus className="mr-1.5 size-3.5" />
                      Add Audit
                    </button>
                  </div>
                </div>
              </div>

              <div>
                {filteredAudits.length === 0 ? (
                  <div className="p-10 text-center">
                    <FileCheck2 className="mx-auto size-9 text-muted-foreground/30" />
                    <p className="mt-3 text-sm font-medium text-foreground">
                      No audit or intervention records found.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredAudits.map((record) => (
                      <div key={record.id}>
                        <AuditRow
                          record={record}
                          selected={
                            selected?.kind === "audit" &&
                            selected.record.id === record.id
                          }
                          onClick={() =>
                            setSelected({
                              kind: "audit",
                              record,
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT INSPECTOR */}
          <div className="xl:sticky xl:top-6">
            <RecordInspector
              selected={selected}
              evidence={data.evidence}
              rules={rules}
              onClose={() => setSelected(null)}
              onEdit={openEdit}
              onArchive={() => selected && setArchiveConfirm(selected)}
              onRestore={handleRestore}
              onPreview={handlePreviewDocument}
            />
          </div>
        </div>
      </div>

      {/* MANUAL MODAL */}
      {manualState && (
        <ManualModal
          state={manualState}
          profile={profile}
          onChange={setManualState}
          onCancel={() => setManualState(null)}
          onSave={() => {
            if (manualState.mode === "authority") {
              const saved = saveAuthority(manualState.draft, "Manual")
              if (saved) {
                setManualState(null)
              }
              return
            }

            if (manualState.mode === "safety") {
              saveSafety(manualState.draft, "Manual")
              setManualState(null)
              return
            }

            saveAudit(manualState.draft, "Manual")
            setManualState(null)
          }}
        />
      )}

      {/* EDIT MODAL */}
      {editingState && selected && (
        <ManualModal
          state={editingState}
          profile={profile}
          onChange={setEditingState}
          onCancel={() => setEditingState(null)}
          onSave={() => {
            const editingId = selected.record.id

            if (editingState.mode === "authority") {
              const saved = saveAuthority(
                editingState.draft,
                selected.record.source,
                undefined,
                editingId
              )

              if (saved) {
                setSelected({
                  kind: "authority",
                  record: {
                    ...(selected.record as AuthorityRecord),
                    ...editingState.draft,
                    updatedAt: isoNow(),
                  },
                })
                setEditingState(null)
              }
              return
            }

            if (editingState.mode === "safety") {
              saveSafety(
                editingState.draft,
                selected.record.source,
                undefined,
                editingId
              )

              setSelected({
                kind: "safety",
                record: {
                  ...(selected.record as SafetyRecord),
                  ...editingState.draft,
                  updatedAt: isoNow(),
                },
              })
              setEditingState(null)
              return
            }

            saveAudit(
              editingState.draft,
              selected.record.source,
              undefined,
              editingId
            )

            setSelected({
              kind: "audit",
              record: {
                ...(selected.record as AuditRecord),
                ...editingState.draft,
                updatedAt: isoNow(),
              },
            })
            setEditingState(null)
          }}
        />
      )}

      {/* ARCHIVE CONFIRMATION MODAL */}
      {archiveConfirm && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden p-6">
            <div className="flex items-center gap-2 text-destructive">
              <Archive className="size-5" />
              <h3 className="text-base font-semibold">Archive Compliance Record</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              Archiving retains the record and its attached certificates in the compliance audit trail while removing it from active lists.
            </p>

            <div className="space-y-1.5 mt-4">
              <label className="text-xs font-semibold text-foreground">Archive Reason</label>
              <input
                type="text"
                value={archiveReasonInput}
                onChange={(e) => setArchiveReasonInput(e.target.value)}
                placeholder="e.g. Authority superseded / Policy renewed / Replaced"
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex justify-end gap-2 pt-5">
              <button
                type="button"
                onClick={() => {
                  setArchiveConfirm(null)
                  setArchiveReasonInput("")
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmArchive}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-sm"
              >
                Confirm Archive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENT SOURCE PICKER */}
      {sourceContext && (
        <DocumentSourcePicker
          isOpen={Boolean(sourceContext)}
          onClose={() => setSourceContext(null)}
          onSelectCamera={() => {
            setSourceContext(sourceContext)
            setShowCamera(true)
          }}
          onSelectFile={(file) => {
            startOCRFile(file, "device")
          }}
        />
      )}

      {/* CAMERA CAPTURE */}
      {showCamera && (
        <CameraCapture
          onClose={() => setShowCamera(false)}
          onCapture={(file) => {
            setShowCamera(false)
            startOCRFile(file, "camera")
          }}
        />
      )}

      {/* OCR WORKSPACE */}
      {ocrSession && (
        <OCRWorkspace
          session={ocrSession}
          profile={profile}
          companyName={company.name}
          setSession={setOcrSession}
          onCancel={() => setOcrSession(null)}
          onReplace={() => {
            const context =
              ocrSession.mode === "authority"
                ? {
                    mode: "authority" as const,
                    category: ocrSession.authorityDraft!.category,
                    authorityType: ocrSession.authorityDraft!.authorityType,
                  }
                : ocrSession.mode === "safety"
                ? {
                    mode: "safety" as const,
                    safetySystem: ocrSession.safetyDraft!.system,
                  }
                : {
                    mode: "audit" as const,
                  }

            setOcrSession(null)
            setSourceContext(context)
          }}
          onSave={saveOCR}
        />
      )}

      {/* SECURE DOCUMENT PREVIEW */}
      {previewEvidence && (
        <div className="fixed inset-0 z-[170] bg-background">
          <SecureDocumentViewer
            fileName={previewEvidence.fileName}
            mimeType={previewEvidence.mimeType}
            dataUrl={previewEvidence.dataUrl}
            documentTitle="Attached Operating Authority Certificate"
            documentDate={previewEvidence.documentDate}
            ocrConfidence={previewEvidence.ocrConfidence}
            watermarkContext={{
              viewerName: "Safety Director",
              viewerRole: "Compliance Officer",
              companyName: company.name,
              timestamp: isoNow(),
            }}
            onClose={() => setPreviewEvidence(null)}
          />
        </div>
      )}

      {/* DEVICE FILE INPUT */}
      <input
        ref={deviceInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          await startOCRFile(file, "device")
        }}
      />
    </>
  )
}
