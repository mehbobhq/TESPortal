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
  ChevronDown,
  Copy,
  Eye,
  FileKey2,
  FileText,
  HardHat,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
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

/* =========================================================
   CORE TYPES
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

type ExpiryStatus =
  | "Healthy"
  | "Watch"
  | "Urgent"
  | "Critical"
  | "Expired"
  | "Archived"

type SourceType =
  | "OCR"
  | "Manual"

type DocumentSource =
  | "camera"
  | "device"

type RecordFamily =
  | "transportation"
  | "workers"
  | "bond"

type Company = {
  id: string
  name: string
  kind?: string

  region?: string

  /*
    IMPORTANT:
    These names remain unchanged because other TES
    modules already consume them.
  */
  regCorpState?: string
  regCorpCountry?: string

  phone?: string
  email?: string
  website?: string

  status?: string
  tone?: string

  createdAt?: string

  [key: string]: any
}

type Relationship = {
  id: string

  companyId: string
  companyName: string

  role: string

  status:
    | "active"
    | "ended"

  startDate: string

  source:
    | "manual"
    | "document"
    | "system"
}

type Contact = {
  id: string
  globalId?: string

  firstName: string
  lastName: string

  email?: string
  phone?: string

  role?: string

  isPrimary?: boolean
  isArchived?: boolean

  relationships?: Relationship[]

  createdAt?: string
  updatedAt?: string

  [key: string]: any
}

/* =========================================================
   INSURANCE MODEL

   COI
      ↓
   Insurance Records[]
      ↓
   Insurer organization
   policy #
   dates
   key coverage

   One COI may create 1, 2, 3, 4, 5+ insurance records.
========================================================= */

type CoverageItem = {
  id: string
  label: string
  value: string
}

type InsuranceEvidence = {
  id: string

  documentName: string
  documentType: string

  source:
    | "camera"
    | "device"

  uploadedAt: string

  ocrConfidence?: number

  /*
    Prototype only.

    Real document storage should later replace dataUrl
    with durable document IDs/storage references.
  */
  dataUrl?: string
}

type BrokerSnapshot = {
  organizationId?: string
  organizationName: string

  contactId?: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string

  clientReference?: string
}

type TransportationInsuranceRecord = {
  id: string
  family: "transportation"

  /*
    Exact text appearing on source document.

    Example:
    "COMMERCIAL GENERAL LIABILITY"
  */
  insuranceType: string

  /*
    TES normalized grouping for filtering/reporting.

    We preserve source wording separately.
  */
  canonicalType: string

  insurerOrganizationId?: string
  insurerName: string

  policyNumber: string

  effectiveDate: string
  expiryDate: string

  coverage: CoverageItem[]

  status: ExpiryStatus

  source: SourceType

  evidenceId?: string

  broker?: BrokerSnapshot

  previousRecordId?: string

  createdAt: string
  updatedAt: string

  archivedAt?: string
  archivedBy?: string
  archiveReason?: string
}

type WorkersInsuranceRecord = {
  id: string
  family: "workers"

  insuranceType: string

  providerOrganizationId?: string
  providerName: string

  policyNumber: string

  jurisdiction?: string

  effectiveDate: string
  expiryDate: string

  coverage: CoverageItem[]

  status: ExpiryStatus

  source: SourceType

  evidenceId?: string

  createdAt: string
  updatedAt: string

  archivedAt?: string
  archivedBy?: string
  archiveReason?: string
}

type BondRecord = {
  id: string
  family: "bond"

  bondType: string

  suretyOrganizationId?: string
  suretyName: string

  bondNumber: string

  principalName: string

  bondAmount?: string

  effectiveDate: string
  expiryDate?: string

  status: ExpiryStatus

  source: SourceType

  evidenceId?: string

  createdAt: string
  updatedAt: string

  archivedAt?: string
  archivedBy?: string
  archiveReason?: string
}

type StoredInsuranceData = {
  version: number

  transportation: TransportationInsuranceRecord[]
  workers: WorkersInsuranceRecord[]
  bonds: BondRecord[]

  evidence: InsuranceEvidence[]
}

/* =========================================================
   OCR WORKSPACE TYPES
========================================================= */

type TransportationDraft = {
  tempId: string

  insuranceType: string
  canonicalType: string

  insurerName: string

  policyNumber: string

  effectiveDate: string
  expiryDate: string

  coverage: CoverageItem[]
}

type OCRWorkspace = {
  source: DocumentSource

  file: File

  dataUrl: string

  processing: boolean
  extractionComplete: boolean

  confidence?: number

  records: TransportationDraft[]

  brokerName: string

  brokerContactName: string
  brokerEmail: string
  brokerPhone: string

  brokerClientReference: string
}

/* =========================================================
   CONSTANTS
========================================================= */

const SETTINGS_STORAGE_KEY =
  "tes_system_settings"

const CONTACT_STORAGE_KEY =
  "tes_contacts_v5"

const DEFAULT_EXPIRY_RULES: ExpiryRules = {
  healthyMinDays: 61,
  watchMinDays: 31,
  urgentMinDays: 11,
  criticalMinDays: 0,
  criticalMaxDays: 10,
}

const EMPTY_DATA: StoredInsuranceData = {
  version: 3,

  transportation: [],
  workers: [],
  bonds: [],

  evidence: [],
}

const TRANSPORTATION_CANONICAL_TYPES = [
  "GENERAL_LIABILITY",
  "AUTOMOBILE_LIABILITY",
  "MOTOR_TRUCK_CARGO",
  "PHYSICAL_DAMAGE",
  "NON_OWNED_TRAILER",
  "TRAILER_INTERCHANGE",
  "UMBRELLA_EXCESS",
  "POLLUTION_ENVIRONMENTAL",
  "OTHER",
]

/* =========================================================
   IDS / DATES
========================================================= */

function createId(prefix: string) {
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

/* =========================================================
   SYSTEM SETTINGS
========================================================= */

function loadSystemSettings(): SystemSettings {
  const fallback: SystemSettings = {
    version: 1,

    expiryRules:
      DEFAULT_EXPIRY_RULES,
  }

  if (typeof window === "undefined") {
    return fallback
  }

  try {
    const raw =
      localStorage.getItem(
        SETTINGS_STORAGE_KEY
      )

    if (!raw) return fallback

    const parsed =
      JSON.parse(raw)

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

/* =========================================================
   STANDARD TES OCR ICON
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
   NORMALIZATION / IDENTITY RESOLUTION
========================================================= */

function normalizeIdentifier(
  value?: string
) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

function normalizePhone(
  value?: string
) {
  let digits =
    String(value || "").replace(
      /\D/g,
      ""
    )

  if (
    digits.length === 11 &&
    digits.startsWith("1")
  ) {
    digits = digits.slice(1)
  }

  return digits
}

function normalizeEmail(
  value?: string
) {
  return String(value || "")
    .trim()
    .toLowerCase()
}

function normalizeCompanyName(
  value?: string
) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'"()]/g, " ")
    .replace(
      /\b(incorporated|inc|corporation|corp|company|co|limited|ltd|insurance|assurance)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim()
}

function normalizePersonName(
  value?: string
) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

/* =========================================================
   LEVENSHTEIN / SIMILARITY
========================================================= */

function levenshtein(
  a: string,
  b: string
) {
  if (!a.length) return b.length
  if (!b.length) return a.length

  const matrix = Array.from(
    {
      length: b.length + 1,
    },
    () =>
      Array(a.length + 1).fill(0)
  )

  for (
    let i = 0;
    i <= b.length;
    i++
  ) {
    matrix[i][0] = i
  }

  for (
    let j = 0;
    j <= a.length;
    j++
  ) {
    matrix[0][j] = j
  }

  for (
    let i = 1;
    i <= b.length;
    i++
  ) {
    for (
      let j = 1;
      j <= a.length;
      j++
    ) {
      const cost =
        b[i - 1] === a[j - 1]
          ? 0
          : 1

      matrix[i][j] =
        Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] +
            cost
        )
    }
  }

  return matrix[b.length][a.length]
}

function similarity(
  a: string,
  b: string
) {
  if (!a || !b) return 0

  const max =
    Math.max(
      a.length,
      b.length
    )

  if (!max) return 100

  const distance =
    levenshtein(a, b)

  return (
    ((max - distance) / max) *
    100
  )
}

/* =========================================================
   ORGANIZATION RESOLUTION

   Extract freely.
   Normalize carefully.
   Resolve aggressively.
   Create reluctantly.
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

function saveCompanies(
  companies: Company[]
) {
  localStorage.setItem(
    "tes_companies",
    JSON.stringify(companies)
  )
}

function resolveOrganization(
  name: string,
  desiredKind:
    | "Insurance Company"
    | "Insurance Broker"
    | "Workers Insurance"
) {
  const cleanName =
    name.trim()

  if (!cleanName) {
    return {
      organizationId:
        undefined,
      organizationName: "",
      created: false,
    }
  }

  const companies =
    getCompanies()

  const normalized =
    normalizeCompanyName(
      cleanName
    )

  /*
    1. Exact normalized name.
  */

  let best =
    companies.find(
      (company) =>
        normalizeCompanyName(
          company.name
        ) === normalized
    )

  if (best) {
    return {
      organizationId:
        best.id,
      organizationName:
        best.name,
      created: false,
    }
  }

  /*
    2. Aggressive fuzzy resolver.

    We intentionally use a high threshold.
    Insurers/brokers are limited entities and we
    want to avoid accidental duplicates, but we
    also do not merge weak name-only matches.
  */

  const scored =
    companies
      .map((company) => ({
        company,

        score: similarity(
          normalized,
          normalizeCompanyName(
            company.name
          )
        ),
      }))
      .filter(
        (result) =>
          result.score >= 92
      )
      .sort(
        (a, b) =>
          b.score - a.score
      )

  if (scored.length) {
    best =
      scored[0].company

    return {
      organizationId:
        best.id,
      organizationName:
        best.name,
      created: false,
    }
  }

  /*
    3. Truly new organization.
  */

  const newOrganization: Company =
    {
      id: createCompanyId(
        companies
      ),

      name: cleanName,

      kind: desiredKind,

      contact: "N/A",

      region:
        "Not specified",

      status: "Active",

      tone: "ok",

      createdAt: isoNow(),

      /*
        Allows future UI to distinguish records
        automatically discovered through OCR.
      */
      discoveredBy:
        "Insurance OCR",
    }

  saveCompanies([
    newOrganization,
    ...companies,
  ])

  return {
    organizationId:
      newOrganization.id,

    organizationName:
      newOrganization.name,

    created: true,
  }
}

function createCompanyId(
  companies: Company[]
) {
  const ids =
    new Set(
      companies.map(
        (company) => company.id
      )
    )

  for (
    let attempt = 0;
    attempt < 100;
    attempt++
  ) {
    const number =
      10000 +
      Math.floor(
        Math.random() * 90000
      )

    const id =
      `CMP-${number}`

    if (!ids.has(id)) {
      return id
    }
  }

  return `CMP-${Date.now()}`
}

/* =========================================================
   CONTACT RESOLUTION

   Same email/phone is strong identity evidence.

   Name-only similarity is NEVER enough to blindly
   create a second Harpreet / Har Preet record.
========================================================= */

function getContacts(): Contact[] {
  try {
    const raw =
      localStorage.getItem(
        CONTACT_STORAGE_KEY
      ) ||
      localStorage.getItem(
        "tes_contacts_v4"
      ) ||
      localStorage.getItem(
        "tes_contacts_v3"
      )

    if (!raw) return []

    const parsed =
      JSON.parse(raw)

    return Array.isArray(parsed)
      ? parsed
      : []
  } catch {
    return []
  }
}

function saveContacts(
  contacts: Contact[]
) {
  localStorage.setItem(
    CONTACT_STORAGE_KEY,
    JSON.stringify(contacts)
  )
}

function splitPersonName(
  fullName: string
) {
  const parts =
    fullName
      .trim()
      .split(/\s+/)
      .filter(Boolean)

  if (!parts.length) {
    return {
      firstName: "",
      lastName: "",
    }
  }

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: "",
    }
  }

  return {
    firstName: parts[0],

    lastName:
      parts.slice(1).join(" "),
  }
}

function resolveBrokerContact({
  brokerOrganizationId,
  brokerOrganizationName,
  contactName,
  email,
  phone,
}: {
  brokerOrganizationId?: string
  brokerOrganizationName: string
  contactName: string
  email: string
  phone: string
}) {
  if (
    !contactName.trim() &&
    !email.trim() &&
    !phone.trim()
  ) {
    return {
      contactId:
        undefined,

      contactName:
        contactName.trim(),

      contactEmail:
        email.trim(),

      contactPhone:
        phone.trim(),

      created: false,
    }
  }

  const contacts =
    getContacts()

  const emailKey =
    normalizeEmail(email)

  const phoneKey =
    normalizePhone(phone)

  /*
    Strong identifiers first.
  */

  let matched =
    contacts.find(
      (contact) =>
        Boolean(emailKey) &&
        normalizeEmail(
          contact.email
        ) === emailKey
    )

  if (!matched) {
    matched =
      contacts.find(
        (contact) =>
          Boolean(phoneKey) &&
          normalizePhone(
            contact.phone
          ) === phoneKey
      )
  }

  /*
    Then name + organization relationship.
  */

  if (
    !matched &&
    contactName.trim()
  ) {
    const nameKey =
      normalizePersonName(
        contactName
      )

    const candidates =
      contacts
        .filter((contact) => {
          const belongsToBroker =
            contact.relationships?.some(
              (relationship) =>
                relationship.companyId ===
                brokerOrganizationId
            )

          return (
            belongsToBroker ||
            !brokerOrganizationId
          )
        })
        .map((contact) => {
          const existing =
            normalizePersonName(
              `${contact.firstName} ${contact.lastName}`
            )

          return {
            contact,

            score:
              similarity(
                nameKey,
                existing
              ),
          }
        })
        .filter(
          (result) =>
            result.score >= 92
        )
        .sort(
          (a, b) =>
            b.score - a.score
        )

    if (candidates.length) {
      matched =
        candidates[0].contact
    }
  }

  if (matched) {
    return {
      contactId:
        matched.id,

      contactName:
        `${matched.firstName} ${matched.lastName}`.trim(),

      contactEmail:
        matched.email ||
        email.trim(),

      contactPhone:
        matched.phone ||
        phone.trim(),

      created: false,
    }
  }

  /*
    No strong/probable identity found.
    Only now do we create.
  */

  const names =
    splitPersonName(
      contactName
    )

  const contactId =
    createId("CNT")

  const newContact: Contact =
    {
      id: contactId,

      globalId:
        createId("USR"),

      firstName:
        names.firstName,

      lastName:
        names.lastName,

      email:
        email.trim(),

      phone:
        phone.trim(),

      role:
        "Insurance Broker Contact",

      isPrimary: false,
      isArchived: false,

      relationships:
        brokerOrganizationId
          ? [
              {
                id: createId(
                  "REL"
                ),

                companyId:
                  brokerOrganizationId,

                companyName:
                  brokerOrganizationName,

                role:
                  "Insurance Broker Contact",

                status:
                  "active",

                startDate:
                  isoNow().slice(
                    0,
                    10
                  ),

                source:
                  "document",
              },
            ]
          : [],

      createdAt: isoNow(),
      updatedAt: isoNow(),

      discoveredBy:
        "Insurance OCR",
    }

  saveContacts([
    newContact,
    ...contacts,
  ])

  return {
    contactId,

    contactName:
      `${newContact.firstName} ${newContact.lastName}`.trim(),

    contactEmail:
      newContact.email || "",

    contactPhone:
      newContact.phone || "",

    created: true,
  }
}

/* =========================================================
   INSURANCE TYPE NORMALIZATION

   Exact source language is preserved.

   Canonical type helps TES understand that:
   COMMERCIAL GENERAL LIABILITY
   GENERAL LIABILITY
   etc. may belong to same family.
========================================================= */

function normalizeInsuranceType(
  raw: string
) {
  const value =
    raw
      .trim()
      .toLowerCase()

  if (
    value.includes(
      "general liability"
    )
  ) {
    return "GENERAL_LIABILITY"
  }

  if (
    value.includes("automobile") ||
    value.includes(
      "auto liability"
    )
  ) {
    return "AUTOMOBILE_LIABILITY"
  }

  if (
    value.includes(
      "motor truck cargo"
    ) ||
    value.includes("cargo")
  ) {
    return "MOTOR_TRUCK_CARGO"
  }

  if (
    value.includes(
      "physical damage"
    )
  ) {
    return "PHYSICAL_DAMAGE"
  }

  if (
    value.includes(
      "non owned trailer"
    ) ||
    value.includes(
      "non-owned trailer"
    )
  ) {
    return "NON_OWNED_TRAILER"
  }

  if (
    value.includes(
      "trailer interchange"
    )
  ) {
    return "TRAILER_INTERCHANGE"
  }

  if (
    value.includes("umbrella") ||
    value.includes("excess")
  ) {
    return "UMBRELLA_EXCESS"
  }

  if (
    value.includes("pollution") ||
    value.includes(
      "environment"
    )
  ) {
    return "POLLUTION_ENVIRONMENTAL"
  }

  return "OTHER"
}

/* =========================================================
   EXPIRY ENGINE
========================================================= */

function getDaysRemaining(
  expiryDate?: string
) {
  if (!expiryDate) return null

  const now = new Date()

  const today =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    )

  const expiry =
    new Date(
      `${expiryDate}T23:59:59`
    )

  return Math.ceil(
    (expiry.getTime() -
      today.getTime()) /
      86400000
  )
}

function getExpiryStatus(
  expiryDate: string | undefined,
  rules: ExpiryRules,
  archived = false
): ExpiryStatus {
  if (archived) {
    return "Archived"
  }

  if (!expiryDate) {
    return "Healthy"
  }

  const days =
    getDaysRemaining(
      expiryDate
    )

  if (days === null) {
    return "Healthy"
  }

  if (days < 0) {
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

/* =========================================================
   STATUS UI
========================================================= */

function statusStyle(
  status: ExpiryStatus
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

    case "Archived":
      return {
        badge:
          "border-slate-200 bg-slate-50 text-slate-600",

        accent:
          "border-l-slate-300",

        text:
          "text-muted-foreground",
      }
  }
}

function ExpiryBadge({
  status,
}: {
  status: ExpiryStatus
}) {
  const style =
    statusStyle(status)

  return (
    <Badge
      variant="outline"
      className={`gap-1 ${style.badge}`}
    >
      {status === "Healthy" && (
        <CheckCircle2 className="size-3" />
      )}

      {status === "Watch" && (
        <CalendarClock className="size-3" />
      )}

      {(status ===
        "Urgent" ||
        status ===
          "Critical") && (
        <AlertTriangle className="size-3" />
      )}

      {status === "Expired" && (
        <XCircle className="size-3" />
      )}

      {status ===
        "Archived" && (
        <Archive className="size-3" />
      )}

      {status}
    </Badge>
  )
}

/* =========================================================
   FILE HELPER
========================================================= */

function readFileAsDataUrl(
  file: File
): Promise<string> {
  return new Promise(
    (resolve, reject) => {
      const reader =
        new FileReader()

      reader.onload = () =>
        resolve(
          String(
            reader.result || ""
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
   DOCUMENT SOURCE PICKER
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
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-lg shadow-2xl">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ScanDocumentIcon
                  size={18}
                />

                Scan Insurance Document
              </CardTitle>

              <CardDescription className="mt-1">
                OCR is the primary insurance data-entry workflow.
              </CardDescription>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCamera}
            className="rounded-xl border p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.035]"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Camera className="size-5" />
            </div>

            <p className="mt-4 text-sm font-semibold">
              Take Photo
            </p>

            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Capture the COI, policy, clearance or bond document using the device camera.
            </p>
          </button>

          <button
            type="button"
            onClick={onDevice}
            className="rounded-xl border p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.035]"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Upload className="size-5" />
            </div>

            <p className="mt-4 text-sm font-semibold">
              Upload from Device
            </p>

            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Select an existing PDF or image from the device.
            </p>
          </button>
        </CardContent>
      </Card>
    </div>
  )
}

/* =========================================================
   ORGANIZATION AUTOCOMPLETE

   Existing TES companies are suggested first.

   Manual and OCR both use the same resolver.
========================================================= */

function OrganizationInput({
  label,
  value,
  onChange,
  kindFilter,
  required = false,
}: {
  label: string
  value: string
  onChange: (
    value: string
  ) => void
  kindFilter?: string[]
  required?: boolean
}) {
  const [open, setOpen] =
    useState(false)

  const companies =
    useMemo(
      () => getCompanies(),
      [open]
    )

  const matches =
    useMemo(() => {
      const q =
        normalizeCompanyName(
          value
        )

      let list =
        companies

      if (
        kindFilter?.length
      ) {
        list =
          companies.filter(
            (company) =>
              kindFilter.includes(
                company.kind || ""
              )
          )
      }

      if (!q) {
        return list.slice(
          0,
          8
        )
      }

      return list
        .map((company) => ({
          company,

          score:
            similarity(
              q,
              normalizeCompanyName(
                company.name
              )
            ),
        }))
        .filter(
          (result) =>
            result.company.name
              .toLowerCase()
              .includes(
                value.toLowerCase()
              ) ||
            result.score >= 60
        )
        .sort(
          (a, b) =>
            b.score - a.score
        )
        .slice(0, 8)
        .map(
          (result) =>
            result.company
        )
    }, [
      companies,
      value,
      kindFilter,
    ])

  return (
    <div className="relative space-y-2">
      <Label>
        {label}
        {required && " *"}
      </Label>

      <div className="relative">
        <Input
          value={value}
          onFocus={() =>
            setOpen(true)
          }
          onChange={(event) => {
            onChange(
              event.target.value
            )

            setOpen(true)
          }}
          onBlur={() => {
            window.setTimeout(
              () =>
                setOpen(false),
              150
            )
          }}
          autoComplete="off"
        />

        <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>

      {open &&
        matches.length > 0 && (
          <div className="absolute left-0 right-0 z-[120] mt-1 max-h-60 overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl">
            {matches.map(
              (company) => (
                <button
                  key={
                    company.id
                  }
                  type="button"
                  onMouseDown={(
                    event
                  ) =>
                    event.preventDefault()
                  }
                  onClick={() => {
                    onChange(
                      company.name
                    )

                    setOpen(false)
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-muted"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {
                        company.name
                      }
                    </p>

                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {
                        company.kind ||
                        "Company"
                      }{" "}
                      ·{" "}
                      {
                        company.id
                      }
                    </p>
                  </div>

                  <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                </button>
              )
            )}
          </div>
        )}
    </div>
  )
}

/* =========================================================
   COVERAGE EDITOR
========================================================= */

function CoverageEditor({
  items,
  onChange,
}: {
  items: CoverageItem[]
  onChange: (
    items: CoverageItem[]
  ) => void
}) {
  const update = (
    id: string,
    field:
      | "label"
      | "value",
    value: string
  ) => {
    onChange(
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]: value,
            }
          : item
      )
    )
  }

  const add = () => {
    onChange([
      ...items,

      {
        id: createId(
          "COV"
        ),

        label: "",
        value: "",
      },
    ])
  }

  const remove = (
    id: string
  ) => {
    onChange(
      items.filter(
        (item) =>
          item.id !== id
      )
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>
            Key Coverage
          </Label>

          <p className="mt-1 text-[10px] text-muted-foreground">
            Surface the 2–3 most useful coverage values. The original document remains available for deeper detail.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={add}
        >
          <Plus className="mr-1 size-3.5" />
          Add
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          No coverage summary added.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(
            (item) => (
              <div
                key={item.id}
                className="grid gap-2 sm:grid-cols-[1fr_1fr_36px]"
              >
                <Input
                  value={
                    item.label
                  }
                  onChange={(
                    event
                  ) =>
                    update(
                      item.id,
                      "label",
                      event
                        .target
                        .value
                    )
                  }
                  placeholder="e.g. General Aggregate"
                />

                <Input
                  value={
                    item.value
                  }
                  onChange={(
                    event
                  ) =>
                    update(
                      item.id,
                      "value",
                      event
                        .target
                        .value
                    )
                  }
                  placeholder="e.g. $2,000,000"
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  onClick={() =>
                    remove(
                      item.id
                    )
                  }
                >
                  <X className="size-4" />
                </Button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

/* =========================================================
   TRANSPORTATION DRAFT CARD
========================================================= */

function TransportationDraftCard({
  index,
  draft,
  onChange,
  onRemove,
  allowRemove,
}: {
  index: number

  draft: TransportationDraft

  onChange: (
    draft: TransportationDraft
  ) => void

  onRemove: () => void

  allowRemove: boolean
}) {
  const update = <
    K extends keyof TransportationDraft
  >(
    key: K,
    value: TransportationDraft[K]
  ) => {
    const next = {
      ...draft,
      [key]: value,
    }

    if (
      key ===
      "insuranceType"
    ) {
      next.canonicalType =
        normalizeInsuranceType(
          String(value)
        )
    }

    onChange(next)
  }

  return (
    <Card className="overflow-visible shadow-none">
      <CardHeader className="border-b bg-muted/15 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm">
              Insurance Record{" "}
              {index + 1}
            </CardTitle>

            <CardDescription className="mt-1 text-[11px]">
              One policy/insurance section detected on this document.
            </CardDescription>
          </div>

          {allowRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onRemove}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>
              Insurance Type *
            </Label>

            <Input
              value={
                draft.insuranceType
              }
              onChange={(
                event
              ) =>
                update(
                  "insuranceType",
                  event.target.value
                )
              }
              placeholder="Exact wording from COI"
            />

            <p className="text-[10px] text-muted-foreground">
              Preserve the exact source wording. TES normalizes it internally without changing the evidence.
            </p>

            {draft.insuranceType && (
              <Badge
                variant="outline"
                className="text-[9px]"
              >
                {
                  draft.canonicalType
                }
              </Badge>
            )}
          </div>

          <OrganizationInput
            label="Insurance Company"
            value={
              draft.insurerName
            }
            onChange={(
              value
            ) =>
              update(
                "insurerName",
                value
              )
            }
            kindFilter={[
              "Insurance Company",
            ]}
            required
          />

          <div className="space-y-2">
            <Label>
              Policy Number *
            </Label>

            <Input
              value={
                draft.policyNumber
              }
              onChange={(
                event
              ) =>
                update(
                  "policyNumber",
                  event.target.value
                )
              }
            />
          </div>

          <div className="space-y-2">
            <Label>
              Effective Date *
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
              Expiry Date *
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
        </div>

        <div className="border-t pt-5">
          <CoverageEditor
            items={
              draft.coverage
            }
            onChange={(
              coverage
            ) =>
              update(
                "coverage",
                coverage
              )
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   OCR / MULTI-POLICY WORKSPACE
========================================================= */

function TransportationWorkspace({
  workspace,
  setWorkspace,
  existingRecords,
  onReplaceDocument,
  onCancel,
  onSave,
}: {
  workspace: OCRWorkspace

  setWorkspace:
    React.Dispatch<
      React.SetStateAction<OCRWorkspace | null>
    >

  existingRecords:
    TransportationInsuranceRecord[]

  onReplaceDocument: () => void

  onCancel: () => void

  onSave: (
    workspace: OCRWorkspace
  ) => void
}) {
  const runOCR = async () => {
    setWorkspace(
      (current) =>
        current
          ? {
              ...current,
              processing: true,
            }
          : current
    )

    /*
      ======================================================
      REAL TES OCR INTEGRATION POINT
      ======================================================

      Expected response should resemble:

      {
        confidence: 96,
        broker: {
          name,
          contactName,
          email,
          phone,
          clientReference
        },
        insuranceRecords: [
          {
            insuranceType:
              "COMMERCIAL GENERAL LIABILITY",
            insurerName:
              "Aurora Underwriting Solutions Inc.",
            policyNumber: "...",
            effectiveDate: "2025-12-24",
            expiryDate: "2026-12-24",
            coverage: [
              {
                label: "General Aggregate",
                value: "2,000,000"
              },
              ...
            ]
          },
          ...
        ]
      }

      DO NOT create entities here.

      OCR only extracts.

      Entity resolution happens during SAVE so both OCR
      and manual input use the same identity engine.
      ======================================================
    */

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          1200
        )
    )

    /*
      No fake business values are invented here.

      The workspace becomes ready for verification and
      manual completion until the real OCR endpoint is
      connected.
    */

    setWorkspace(
      (current) =>
        current
          ? {
              ...current,

              processing:
                false,

              extractionComplete:
                true,

              confidence: 90,
            }
          : current
    )
  }

  const addRecord = () => {
    setWorkspace(
      (current) => {
        if (!current) {
          return current
        }

        return {
          ...current,

          records: [
            ...current.records,

            emptyTransportationDraft(),
          ],
        }
      }
    )
  }

  const updateRecord = (
    index: number,
    draft: TransportationDraft
  ) => {
    setWorkspace(
      (current) => {
        if (!current) {
          return current
        }

        return {
          ...current,

          records:
            current.records.map(
              (
                item,
                itemIndex
              ) =>
                itemIndex ===
                index
                  ? draft
                  : item
            ),
        }
      }
    )
  }

  const removeRecord = (
    index: number
  ) => {
    setWorkspace(
      (current) => {
        if (!current) {
          return current
        }

        return {
          ...current,

          records:
            current.records.filter(
              (
                _,
                itemIndex
              ) =>
                itemIndex !==
                index
            ),
        }
      }
    )
  }

  const duplicateMessages =
    useMemo(() => {
      const messages:
        string[] = []

      workspace.records.forEach(
        (
          draft,
          index
        ) => {
          if (
            !draft.policyNumber.trim() ||
            !draft.insurerName.trim()
          ) {
            return
          }

          const normalizedPolicy =
            normalizeIdentifier(
              draft.policyNumber
            )

          const normalizedInsurer =
            normalizeCompanyName(
              draft.insurerName
            )

          const exact =
            existingRecords.find(
              (record) =>
                record.status !==
                  "Archived" &&
                normalizeIdentifier(
                  record.policyNumber
                ) ===
                  normalizedPolicy &&
                normalizeCompanyName(
                  record.insurerName
                ) ===
                  normalizedInsurer &&
                record.effectiveDate ===
                  draft.effectiveDate &&
                record.expiryDate ===
                  draft.expiryDate
            )

          if (exact) {
            messages.push(
              `Record ${index + 1}: policy ${draft.policyNumber} already exists for this insurer and policy period.`
            )
          }
        }
      )

      return messages
    }, [
      workspace.records,
      existingRecords,
    ])

  const complete =
    workspace.records.length >
      0 &&
    workspace.records.every(
      (record) =>
        record.insuranceType
          .trim() &&
        record.insurerName
          .trim() &&
        record.policyNumber
          .trim() &&
        record.effectiveDate &&
        record.expiryDate
    )

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-background">
      {/* HEADER */}

      <div className="flex min-h-16 items-center justify-between gap-4 border-b px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ScanDocumentIcon
              size={18}
            />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">
                Insurance Document Intelligence
              </p>

              <Badge
                variant="outline"
                className="gap-1 text-[9px]"
              >
                <Sparkles className="size-3" />
                AI Assisted
              </Badge>
            </div>

            <p className="mt-0.5 max-w-xl truncate text-[10px] text-muted-foreground">
              {
                workspace.file.name
              }
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
        >
          <X className="size-5" />
        </Button>
      </div>

      {/* BODY */}

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(420px,0.95fr)_minmax(640px,1.05fr)]">
        {/* DOCUMENT */}

        <div className="flex min-h-0 flex-col border-r bg-muted/15">
          <div className="flex items-center justify-between gap-3 border-b bg-background px-4 py-3">
            <div>
              <p className="text-xs font-semibold">
                Original Document
              </p>

              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Source evidence
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={
                  onReplaceDocument
                }
              >
                <RotateCcw className="mr-1.5 size-3.5" />

                Replace
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() =>
                  window.open(
                    workspace.dataUrl,
                    "_blank",
                    "noopener,noreferrer"
                  )
                }
              >
                <Eye className="mr-1.5 size-3.5" />

                Full View
              </Button>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center overflow-auto p-5">
            {workspace.file.type ===
            "application/pdf" ? (
              <iframe
                src={
                  workspace.dataUrl
                }
                title="Insurance document"
                className="h-full min-h-[650px] w-full rounded-lg border bg-background"
              />
            ) : (
              <img
                src={
                  workspace.dataUrl
                }
                alt="Insurance document"
                className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
              />
            )}
          </div>
        </div>

        {/* EXTRACTION */}

        <div className="flex min-h-0 flex-col">
          <div className="border-b p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">
                  Detected Insurance Records
                </h2>

                <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                  One document can contain multiple insurers, policy numbers and insurance types. Review every detected record before saving.
                </p>
              </div>

              {workspace.extractionComplete &&
                workspace.confidence !==
                  undefined && (
                  <div className="text-right">
                    <p className="text-xl font-bold text-emerald-600">
                      {
                        workspace.confidence
                      }
                      %
                    </p>

                    <p className="text-[10px] text-muted-foreground">
                      extraction confidence
                    </p>
                  </div>
                )}
            </div>

            {!workspace.extractionComplete && (
              <Button
                type="button"
                className="mt-4"
                onClick={runOCR}
                disabled={
                  workspace.processing
                }
              >
                {workspace.processing ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Reading Document...
                  </>
                ) : (
                  <>
                    <ScanDocumentIcon
                      size={15}
                    />

                    <span className="ml-2">
                      Extract Insurance Data
                    </span>
                  </>
                )}
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <div className="space-y-5">
              {workspace.extractionComplete && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />

                    <div>
                      <p className="text-xs font-semibold">
                        Extraction ready for verification
                      </p>

                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        OCR extraction should populate these records automatically when the production OCR endpoint is connected. The same structured fields remain editable for verification.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {workspace.records.map(
                (
                  draft,
                  index
                ) => (
                  <TransportationDraftCard
                    key={
                      draft.tempId
                    }
                    index={index}
                    draft={draft}
                    onChange={(
                      next
                    ) =>
                      updateRecord(
                        index,
                        next
                      )
                    }
                    onRemove={() =>
                      removeRecord(
                        index
                      )
                    }
                    allowRemove={
                      workspace.records
                        .length > 1
                    }
                  />
                )
              )}

              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed"
                onClick={addRecord}
              >
                <Plus className="mr-2 size-4" />
                Add Another Insurance Record
              </Button>

              {/* BROKER */}

              <Card className="overflow-visible border-primary/15 shadow-none">
                <CardHeader className="border-b bg-primary/[0.025] py-4">
                  <CardTitle className="text-sm">
                    Insurance Broker
                  </CardTitle>

                  <CardDescription className="text-xs">
                    Broker information applies to this certificate/document and is resolved against existing TES organizations and contacts before creation.
                  </CardDescription>
                </CardHeader>

                <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
                  <OrganizationInput
                    label="Broker / Agency"
                    value={
                      workspace.brokerName
                    }
                    onChange={(
                      value
                    ) =>
                      setWorkspace(
                        (
                          current
                        ) =>
                          current
                            ? {
                                ...current,
                                brokerName:
                                  value,
                              }
                            : current
                      )
                    }
                    kindFilter={[
                      "Insurance Broker",
                    ]}
                  />

                  <div className="space-y-2">
                    <Label>
                      Broker Contact
                    </Label>

                    <Input
                      value={
                        workspace.brokerContactName
                      }
                      onChange={(
                        event
                      ) =>
                        setWorkspace(
                          (
                            current
                          ) =>
                            current
                              ? {
                                  ...current,

                                  brokerContactName:
                                    event
                                      .target
                                      .value,
                                }
                              : current
                        )
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Broker Email
                    </Label>

                    <Input
                      type="email"
                      value={
                        workspace.brokerEmail
                      }
                      onChange={(
                        event
                      ) =>
                        setWorkspace(
                          (
                            current
                          ) =>
                            current
                              ? {
                                  ...current,

                                  brokerEmail:
                                    event
                                      .target
                                      .value,
                                }
                              : current
                        )
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Broker Phone
                    </Label>

                    <Input
                      type="tel"
                      value={
                        workspace.brokerPhone
                      }
                      onChange={(
                        event
                      ) =>
                        setWorkspace(
                          (
                            current
                          ) =>
                            current
                              ? {
                                  ...current,

                                  brokerPhone:
                                    event
                                      .target
                                      .value,
                                }
                              : current
                        )
                      }
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label>
                      Broker Client / Reference ID
                    </Label>

                    <Input
                      value={
                        workspace.brokerClientReference
                      }
                      onChange={(
                        event
                      ) =>
                        setWorkspace(
                          (
                            current
                          ) =>
                            current
                              ? {
                                  ...current,

                                  brokerClientReference:
                                    event
                                      .target
                                      .value,
                                }
                              : current
                        )
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              {duplicateMessages.length >
                0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 text-red-700" />

                    <div>
                      <p className="text-xs font-semibold text-red-800">
                        Existing policy record detected
                      </p>

                      <div className="mt-2 space-y-1">
                        {duplicateMessages.map(
                          (
                            message
                          ) => (
                            <p
                              key={
                                message
                              }
                              className="text-[11px] text-red-700"
                            >
                              {
                                message
                              }
                            </p>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t bg-background p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[10px] text-muted-foreground">
                Organizations and broker contacts are resolved against existing TES identities before any new record is created.
              </p>

              <Button
                type="button"
                disabled={
                  !complete ||
                  duplicateMessages.length >
                    0
                }
                onClick={() =>
                  onSave(
                    workspace
                  )
                }
              >
                <Check className="mr-2 size-4" />
                Verify & Save All
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   MANUAL TRANSPORTATION FORM

   SAME DATA MODEL AS OCR.
========================================================= */

function ManualTransportationForm({
  existingRecords,
  onCancel,
  onSave,
}: {
  existingRecords:
    TransportationInsuranceRecord[]

  onCancel: () => void

  onSave: (
    drafts: TransportationDraft[],
    broker: {
      brokerName: string
      contactName: string
      email: string
      phone: string
      clientReference: string
    }
  ) => void
}) {
  const [drafts, setDrafts] =
    useState<
      TransportationDraft[]
    >([
      emptyTransportationDraft(),
    ])

  const [brokerName, setBrokerName] =
    useState("")

  const [
    brokerContactName,
    setBrokerContactName,
  ] = useState("")

  const [brokerEmail, setBrokerEmail] =
    useState("")

  const [brokerPhone, setBrokerPhone] =
    useState("")

  const [
    brokerClientReference,
    setBrokerClientReference,
  ] = useState("")

  const updateDraft = (
    index: number,
    draft: TransportationDraft
  ) => {
    setDrafts(
      (current) =>
        current.map(
          (
            item,
            itemIndex
          ) =>
            itemIndex ===
            index
              ? draft
              : item
        )
    )
  }

  const complete =
    drafts.length > 0 &&
    drafts.every(
      (draft) =>
        draft.insuranceType
          .trim() &&
        draft.insurerName
          .trim() &&
        draft.policyNumber
          .trim() &&
        draft.effectiveDate &&
        draft.expiryDate
    )

  return (
    <Card className="overflow-visible border-primary/20">
      <CardHeader className="border-b bg-primary/[0.025]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">
              Enter Transportation Insurance Manually
            </CardTitle>

            <CardDescription className="mt-1">
              Manual entry creates the exact same record structure as OCR.
            </CardDescription>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
          >
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-5">
        {drafts.map(
          (
            draft,
            index
          ) => (
            <TransportationDraftCard
              key={
                draft.tempId
              }
              index={index}
              draft={draft}
              onChange={(
                next
              ) =>
                updateDraft(
                  index,
                  next
                )
              }
              onRemove={() =>
                setDrafts(
                  (
                    current
                  ) =>
                    current.filter(
                      (
                        _,
                        itemIndex
                      ) =>
                        itemIndex !==
                        index
                    )
                )
              }
              allowRemove={
                drafts.length > 1
              }
            />
          )
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full border-dashed"
          onClick={() =>
            setDrafts(
              (
                current
              ) => [
                ...current,
                emptyTransportationDraft(),
              ]
            )
          }
        >
          <Plus className="mr-2 size-4" />
          Add Another Insurance Record
        </Button>

        <Card className="overflow-visible shadow-none">
          <CardHeader className="border-b bg-muted/15 py-4">
            <CardTitle className="text-sm">
              Insurance Broker
            </CardTitle>
          </CardHeader>

          <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
            <OrganizationInput
              label="Broker / Agency"
              value={
                brokerName
              }
              onChange={
                setBrokerName
              }
              kindFilter={[
                "Insurance Broker",
              ]}
            />

            <div className="space-y-2">
              <Label>
                Broker Contact
              </Label>

              <Input
                value={
                  brokerContactName
                }
                onChange={(
                  event
                ) =>
                  setBrokerContactName(
                    event.target.value
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <Label>
                Broker Email
              </Label>

              <Input
                type="email"
                value={
                  brokerEmail
                }
                onChange={(
                  event
                ) =>
                  setBrokerEmail(
                    event.target.value
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <Label>
                Broker Phone
              </Label>

              <Input
                value={
                  brokerPhone
                }
                onChange={(
                  event
                ) =>
                  setBrokerPhone(
                    event.target.value
                  )
                }
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>
                Broker Client / Reference ID
              </Label>

              <Input
                value={
                  brokerClientReference
                }
                onChange={(
                  event
                ) =>
                  setBrokerClientReference(
                    event.target.value
                  )
                }
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2 border-t pt-5">
          <Button
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>

          <Button
            disabled={!complete}
            onClick={() =>
              onSave(
                drafts,
                {
                  brokerName,

                  contactName:
                    brokerContactName,

                  email:
                    brokerEmail,

                  phone:
                    brokerPhone,

                  clientReference:
                    brokerClientReference,
                }
              )
            }
          >
            <Check className="mr-2 size-4" />
            Save Records
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   EMPTY TRANSPORTATION DRAFT
========================================================= */

function emptyTransportationDraft():
  TransportationDraft {
  return {
    tempId: createId(
      "TMP"
    ),

    insuranceType: "",
    canonicalType: "OTHER",

    insurerName: "",

    policyNumber: "",

    effectiveDate: "",
    expiryDate: "",

    coverage: [],
  }
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
  const [copied, setCopied] =
    useState(false)

  const copy = async () => {
    if (!value) return

    try {
      await navigator.clipboard.writeText(
        value
      )

      setCopied(true)

      window.setTimeout(
        () =>
          setCopied(false),
        1000
      )
    } catch {
      // Clipboard can fail in non-secure dev environments.
    }
  }

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>

      <div className="mt-1 flex items-center gap-1">
        <span className="min-w-0 flex-1 select-text break-all text-xs font-medium">
          {value || "—"}
        </span>

        {value && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={copy}
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
   TRANSPORTATION RECORD ROW
========================================================= */

function TransportationRecordRow({
  record,
  onEdit,
  onArchive,
}: {
  record:
    TransportationInsuranceRecord

  onEdit: () => void

  onArchive: () => void
}) {
  const days =
    getDaysRemaining(
      record.expiryDate
    )

  const style =
    statusStyle(
      record.status
    )

  return (
    <div
      className={`border-l-4 p-4 transition-colors hover:bg-muted/20 ${style.accent} ${
        record.status ===
        "Archived"
          ? "opacity-60"
          : ""
      }`}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(200px,1fr)_minmax(180px,0.8fr)_150px_auto] lg:items-center">
        {/* TYPE */}

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">
              {
                record.insuranceType
              }
            </p>

            {record.source ===
              "OCR" && (
              <Badge
                variant="outline"
                className="text-[9px]"
              >
                OCR
              </Badge>
            )}
          </div>

          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {record.id}
          </p>
        </div>

        {/* INSURER */}

        <div>
          <p className="text-sm font-medium">
            {
              record.insurerName
            }
          </p>

          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            Policy{" "}
            {
              record.policyNumber
            }
          </p>
        </div>

        {/* COVERAGE */}

        <div>
          {record.coverage.length >
          0 ? (
            <div className="space-y-1">
              {record.coverage
                .slice(0, 3)
                .map(
                  (coverage) => (
                    <div
                      key={
                        coverage.id
                      }
                      className="flex items-center justify-between gap-3 text-[10px]"
                    >
                      <span className="truncate text-muted-foreground">
                        {
                          coverage.label
                        }
                      </span>

                      <span className="shrink-0 font-medium">
                        {
                          coverage.value
                        }
                      </span>
                    </div>
                  )
                )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              Coverage in source document
            </span>
          )}
        </div>

        {/* DATES */}

        <div className="text-xs">
          <p>
            {
              record.effectiveDate
            }
          </p>

          <p
            className={`mt-1 ${style.text}`}
          >
            {
              record.expiryDate
            }
          </p>

          {days !== null && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {days < 0
                ? `${Math.abs(days)} days overdue`
                : days === 0
                  ? "Expires today"
                  : `${days} days remaining`}
            </p>
          )}
        </div>

        {/* STATUS */}

        <div className="flex items-center justify-end gap-1">
          <ExpiryBadge
            status={
              record.status
            }
          />

          {record.status !==
            "Archived" && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={onEdit}
                title="Edit record"
              >
                <Pencil className="size-3.5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={
                  onArchive
                }
                title="Archive record"
              >
                <Archive className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {record.broker
        ?.organizationName && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t pt-3 text-[10px] text-muted-foreground">
          <span>
            Broker:{" "}
            <strong className="text-foreground">
              {
                record.broker
                  .organizationName
              }
            </strong>
          </span>

          {record.broker
            .contactName && (
            <span>
              Contact:{" "}
              {
                record.broker
                  .contactName
              }
            </span>
          )}

          {record.broker
            .contactPhone && (
            <span>
              {
                record.broker
                  .contactPhone
              }
            </span>
          )}

          {record.broker
            .contactEmail && (
            <span>
              {
                record.broker
                  .contactEmail
              }
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* =========================================================
   EDIT TRANSPORTATION MODAL
========================================================= */

function EditTransportationModal({
  record,
  onCancel,
  onSave,
}: {
  record:
    TransportationInsuranceRecord

  onCancel: () => void

  onSave: (
    record:
      TransportationInsuranceRecord
  ) => void
}) {
  const [draft, setDraft] =
    useState<TransportationDraft>({
      tempId:
        record.id,

      insuranceType:
        record.insuranceType,

      canonicalType:
        record.canonicalType,

      insurerName:
        record.insurerName,

      policyNumber:
        record.policyNumber,

      effectiveDate:
        record.effectiveDate,

      expiryDate:
        record.expiryDate,

      coverage:
        record.coverage,
    })

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto">
        <TransportationDraftCard
          index={0}
          draft={draft}
          onChange={setDraft}
          onRemove={() => {}}
          allowRemove={false}
        />

        <div className="mt-3 flex justify-end gap-2 rounded-xl border bg-background p-3 shadow-lg">
          <Button
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>

          <Button
            onClick={() =>
              onSave({
                ...record,

                insuranceType:
                  draft.insuranceType,

                canonicalType:
                  normalizeInsuranceType(
                    draft.insuranceType
                  ),

                insurerName:
                  draft.insurerName,

                policyNumber:
                  draft.policyNumber,

                effectiveDate:
                  draft.effectiveDate,

                expiryDate:
                  draft.expiryDate,

                coverage:
                  draft.coverage,

                updatedAt:
                  isoNow(),
              })
            }
          >
            <Save className="mr-2 size-4" />
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   SIMPLE WORKERS / BOND FORM

   Separate record families as agreed.
========================================================= */

function SimpleRecordForm({
  family,
  company,
  onCancel,
  onSaveWorkers,
  onSaveBond,
}: {
  family:
    | "workers"
    | "bond"

  company: Company

  onCancel: () => void

  onSaveWorkers: (
    record:
      Omit<
        WorkersInsuranceRecord,
        | "id"
        | "status"
        | "createdAt"
        | "updatedAt"
      >
  ) => void

  onSaveBond: (
    record:
      Omit<
        BondRecord,
        | "id"
        | "status"
        | "createdAt"
        | "updatedAt"
      >
  ) => void
}) {
  const [type, setType] =
    useState("")

  const [provider, setProvider] =
    useState("")

  const [number, setNumber] =
    useState("")

  const [jurisdiction, setJurisdiction] =
    useState("")

  const [effective, setEffective] =
    useState("")

  const [expiry, setExpiry] =
    useState("")

  const [amount, setAmount] =
    useState("")

  const [principal, setPrincipal] =
    useState(company.name)

  const [coverage, setCoverage] =
    useState<CoverageItem[]>(
      []
    )

  const submit = () => {
    if (
      !type ||
      !provider.trim() ||
      !number.trim() ||
      !effective
    ) {
      return
    }

    if (
      family ===
        "workers" &&
      !expiry
    ) {
      return
    }

    if (
      family ===
      "workers"
    ) {
      onSaveWorkers({
        family:
          "workers",

        insuranceType:
          type,

        providerName:
          provider.trim(),

        policyNumber:
          number.trim(),

        jurisdiction:
          jurisdiction.trim(),

        effectiveDate:
          effective,

        expiryDate:
          expiry,

        coverage,

        source:
          "Manual",
      })

      return
    }

    onSaveBond({
      family: "bond",

      bondType: type,

      suretyName:
        provider.trim(),

      bondNumber:
        number.trim(),

      principalName:
        principal.trim(),

      bondAmount:
        amount.trim(),

      effectiveDate:
        effective,

      expiryDate:
        expiry || undefined,

      source:
        "Manual",
    })
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="border-b bg-primary/[0.025]">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">
              Add{" "}
              {family ===
              "workers"
                ? "Workers Insurance"
                : "Surety Bond"}
            </CardTitle>

            <CardDescription className="mt-1">
              This remains a separate record family from transportation insurance.
            </CardDescription>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
          >
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>
              {family ===
              "workers"
                ? "Insurance Type *"
                : "Bond Type *"}
            </Label>

            <Select
              value={type}
              onValueChange={
                setType
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>

              <SelectContent>
                {family ===
                "workers" ? (
                  <>
                    <SelectItem value="Workers Compensation">
                      Workers Compensation
                    </SelectItem>

                    <SelectItem value="Occupational Accident">
                      Occupational Accident
                    </SelectItem>

                    <SelectItem value="Employer Liability">
                      Employer Liability
                    </SelectItem>

                    <SelectItem value="WSIB">
                      WSIB
                    </SelectItem>

                    <SelectItem value="Provincial Workers Compensation">
                      Provincial Workers Compensation
                    </SelectItem>

                    <SelectItem value="Other">
                      Other
                    </SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="BMC-84 Freight Broker Bond">
                      BMC-84 Freight Broker Bond
                    </SelectItem>

                    <SelectItem value="BMC-85 Trust Fund">
                      BMC-85 Trust Fund
                    </SelectItem>

                    <SelectItem value="MCS-82 Public Liability Surety Bond">
                      MCS-82 Public Liability Surety Bond
                    </SelectItem>

                    <SelectItem value="BMC-83 Cargo Surety Bond">
                      BMC-83 Cargo Surety Bond
                    </SelectItem>

                    <SelectItem value="Customs Bond">
                      Customs Bond
                    </SelectItem>

                    <SelectItem value="IFTA Fuel Tax Bond">
                      IFTA Fuel Tax Bond
                    </SelectItem>

                    <SelectItem value="OSOW / Permit Bond">
                      OSOW / Permit Bond
                    </SelectItem>

                    <SelectItem value="Other">
                      Other
                    </SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <OrganizationInput
            label={
              family ===
              "workers"
                ? "Insurance Company / Board"
                : "Surety Company"
            }
            value={provider}
            onChange={
              setProvider
            }
            kindFilter={
              family ===
              "workers"
                ? [
                    "Insurance Company",
                    "Workers Insurance",
                  ]
                : [
                    "Insurance Company",
                  ]
            }
            required
          />

          <div className="space-y-2">
            <Label>
              {family ===
              "workers"
                ? "Policy / Account Number *"
                : "Bond Number *"}
            </Label>

            <Input
              value={number}
              onChange={(
                event
              ) =>
                setNumber(
                  event.target.value
                )
              }
            />
          </div>

          {family ===
            "workers" && (
            <div className="space-y-2">
              <Label>
                Jurisdiction
              </Label>

              <Input
                value={
                  jurisdiction
                }
                onChange={(
                  event
                ) =>
                  setJurisdiction(
                    event.target.value
                  )
                }
                placeholder="e.g. Ontario"
              />
            </div>
          )}

          {family ===
            "bond" && (
            <>
              <div className="space-y-2">
                <Label>
                  Principal
                </Label>

                <Input
                  value={
                    principal
                  }
                  onChange={(
                    event
                  ) =>
                    setPrincipal(
                      event.target.value
                    )
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Bond Amount
                </Label>

                <Input
                  value={amount}
                  onChange={(
                    event
                  ) =>
                    setAmount(
                      event.target.value
                    )
                  }
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label>
              Effective Date *
            </Label>

            <Input
              type="date"
              value={effective}
              onChange={(
                event
              ) =>
                setEffective(
                  event.target.value
                )
              }
            />
          </div>

          <div className="space-y-2">
            <Label>
              Expiry Date
              {family ===
                "workers" &&
                " *"}
            </Label>

            <Input
              type="date"
              value={expiry}
              onChange={(
                event
              ) =>
                setExpiry(
                  event.target.value
                )
              }
            />
          </div>
        </div>

        {family ===
          "workers" && (
          <CoverageEditor
            items={coverage}
            onChange={
              setCoverage
            }
          />
        )}

        <div className="flex justify-end gap-2 border-t pt-5">
          <Button
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>

          <Button
            onClick={submit}
          >
            <Check className="mr-2 size-4" />
            Save Record
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   ARCHIVE CONFIRMATION
========================================================= */

function ArchiveDialog({
  label,
  onCancel,
  onConfirm,
}: {
  label: string

  onCancel: () => void

  onConfirm: (
    reason: string
  ) => void
}) {
  const [reason, setReason] =
    useState("")

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">
            Archive Record
          </CardTitle>

          <CardDescription>
            {label} will remain permanently available as historical information.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="space-y-2">
            <Label>
              Archive Reason *
            </Label>

            <Input
              value={reason}
              onChange={(
                event
              ) =>
                setReason(
                  event.target.value
                )
              }
              placeholder="e.g. Replaced by renewal"
            />
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onCancel}
            >
              Cancel
            </Button>

            <Button
              disabled={
                !reason.trim()
              }
              onClick={() =>
                onConfirm(
                  reason.trim()
                )
              }
            >
              <Archive className="mr-2 size-4" />
              Archive
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* =========================================================
   SIMPLE ROWS
========================================================= */

function WorkersRow({
  record,
  onArchive,
}: {
  record:
    WorkersInsuranceRecord

  onArchive: () => void
}) {
  const days =
    getDaysRemaining(
      record.expiryDate
    )

  const style =
    statusStyle(
      record.status
    )

  return (
    <div
      className={`grid gap-4 border-l-4 p-4 md:grid-cols-12 ${style.accent}`}
    >
      <div className="md:col-span-3">
        <p className="text-sm font-semibold">
          {
            record.insuranceType
          }
        </p>

        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {
            record.policyNumber
          }
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="text-sm">
          {
            record.providerName
          }
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          {
            record.jurisdiction ||
            "Jurisdiction not recorded"
          }
        </p>
      </div>

      <div className="md:col-span-2">
        {record.coverage
          .slice(0, 2)
          .map(
            (item) => (
              <p
                key={
                  item.id
                }
                className="text-[10px]"
              >
                {
                  item.label
                }
                :{" "}
                <strong>
                  {
                    item.value
                  }
                </strong>
              </p>
            )
          )}
      </div>

      <div className="md:col-span-2 text-xs">
        <p>
          {
            record.effectiveDate
          }
        </p>

        <p
          className={`mt-1 ${style.text}`}
        >
          {
            record.expiryDate
          }
        </p>

        {days !== null && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {days >= 0
              ? `${days} days remaining`
              : `${Math.abs(days)} days overdue`}
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 md:col-span-2">
        <ExpiryBadge
          status={
            record.status
          }
        />

        {record.status !==
          "Archived" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={
              onArchive
            }
          >
            <Archive className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

function BondRow({
  record,
  onArchive,
}: {
  record: BondRecord
  onArchive: () => void
}) {
  const style =
    statusStyle(
      record.status
    )

  return (
    <div
      className={`grid gap-4 border-l-4 p-4 md:grid-cols-12 ${style.accent}`}
    >
      <div className="md:col-span-3">
        <p className="text-sm font-semibold">
          {
            record.bondType
          }
        </p>

        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {
            record.bondNumber
          }
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="text-sm">
          {
            record.suretyName
          }
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          Principal:{" "}
          {
            record.principalName
          }
        </p>
      </div>

      <div className="md:col-span-2 font-mono text-xs">
        {
          record.bondAmount ||
          "—"
        }
      </div>

      <div className="md:col-span-2 text-xs">
        <p>
          {
            record.effectiveDate
          }
        </p>

        <p
          className={`mt-1 ${style.text}`}
        >
          {
            record.expiryDate ||
            "Continuous"
          }
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 md:col-span-2">
        <ExpiryBadge
          status={
            record.status
          }
        />

        {record.status !==
          "Archived" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={
              onArchive
            }
          >
            <Archive className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function InsurancePage() {
  const params = useParams()
  const router = useRouter()

  const companyId =
    params.id as string

  const cameraInputRef =
    useRef<HTMLInputElement | null>(
      null
    )

  const deviceInputRef =
    useRef<HTMLInputElement | null>(
      null
    )

  const [company, setCompany] =
    useState<Company | null>(
      null
    )

  const [data, setData] =
    useState<StoredInsuranceData>(
      EMPTY_DATA
    )

  const [settings, setSettings] =
    useState<SystemSettings>({
      version: 1,
      expiryRules:
        DEFAULT_EXPIRY_RULES,
    })

  const [loading, setLoading] =
    useState(true)

  const [
    showSourcePicker,
    setShowSourcePicker,
  ] = useState(false)

  const [
    workspace,
    setWorkspace,
  ] = useState<OCRWorkspace | null>(
    null
  )

  const [
    manualTransportation,
    setManualTransportation,
  ] = useState(false)

  const [simpleForm, setSimpleForm] =
    useState<
      | "workers"
      | "bond"
      | null
    >(null)

  const [
    editingTransportation,
    setEditingTransportation,
  ] =
    useState<TransportationInsuranceRecord | null>(
      null
    )

  const [
    archiveTarget,
    setArchiveTarget,
  ] = useState<{
    family: RecordFamily
    id: string
    label: string
  } | null>(null)

  const storageKey =
    `tes_company_insurance_${companyId}`

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
        found || null
      )

      const raw =
        localStorage.getItem(
          storageKey
        )

      if (!raw) {
        setData(
          EMPTY_DATA
        )
      } else {
        const parsed =
          JSON.parse(raw)

        /*
          New model
        */

        if (
          parsed &&
          !Array.isArray(parsed) &&
          Array.isArray(
            parsed.transportation
          )
        ) {
          setData({
            ...EMPTY_DATA,
            ...parsed,

            transportation:
              parsed.transportation ||
              [],

            workers:
              parsed.workers ||
              [],

            bonds:
              parsed.bonds ||
              [],

            evidence:
              parsed.evidence ||
              [],
          })
        } else if (
          Array.isArray(parsed)
        ) {
          /*
            Legacy migration from previous flat InsuranceRecord[].
          */

          const migrated =
            migrateLegacyRecords(
              parsed
            )

          setData(
            migrated
          )
        }
      }

      setSettings(
        loadSystemSettings()
      )
    } catch (error) {
      console.error(
        "Unable to load insurance data:",
        error
      )

      setData(
        EMPTY_DATA
      )
    } finally {
      setLoading(false)
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
        JSON.stringify(data)
      )
    }
  }, [
    data,
    loading,
    storageKey,
  ])

  /* =======================================================
     RE-CALCULATE STATUS FROM PORTAL SETTINGS
  ======================================================= */

  const transportation =
    useMemo(
      () =>
        data.transportation.map(
          (record) => ({
            ...record,

            status:
              getExpiryStatus(
                record.expiryDate,

                settings.expiryRules,

                Boolean(
                  record.archivedAt
                ) ||
                  record.status ===
                    "Archived"
              ),
          })
        ),

      [
        data.transportation,
        settings.expiryRules,
      ]
    )

  const workers =
    useMemo(
      () =>
        data.workers.map(
          (record) => ({
            ...record,

            status:
              getExpiryStatus(
                record.expiryDate,

                settings.expiryRules,

                Boolean(
                  record.archivedAt
                ) ||
                  record.status ===
                    "Archived"
              ),
          })
        ),

      [
        data.workers,
        settings.expiryRules,
      ]
    )

  const bonds =
    useMemo(
      () =>
        data.bonds.map(
          (record) => ({
            ...record,

            status:
              getExpiryStatus(
                record.expiryDate,

                settings.expiryRules,

                Boolean(
                  record.archivedAt
                ) ||
                  record.status ===
                    "Archived"
              ),
          })
        ),

      [
        data.bonds,
        settings.expiryRules,
      ]
    )

  const allStatuses =
    [
      ...transportation,
      ...workers,
      ...bonds,
    ]

  const counts =
    useMemo(
      () => ({
        healthy:
          allStatuses.filter(
            (item) =>
              item.status ===
              "Healthy"
          ).length,

        watch:
          allStatuses.filter(
            (item) =>
              item.status ===
              "Watch"
          ).length,

        urgent:
          allStatuses.filter(
            (item) =>
              item.status ===
              "Urgent"
          ).length,

        critical:
          allStatuses.filter(
            (item) =>
              item.status ===
              "Critical"
          ).length,

        expired:
          allStatuses.filter(
            (item) =>
              item.status ===
              "Expired"
          ).length,
      }),

      [allStatuses]
    )

  const activeTransportation =
    transportation.filter(
      (record) =>
        ![
          "Expired",
          "Archived",
        ].includes(
          record.status
        )
    )

  /* =======================================================
     DOCUMENT INPUT
  ======================================================= */

  const beginDocument = async (
    file: File,
    source: DocumentSource
  ) => {
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

    setWorkspace({
      source,

      file,

      dataUrl,

      processing: false,

      extractionComplete:
        false,

      records: [
        emptyTransportationDraft(),
      ],

      brokerName: "",

      brokerContactName: "",

      brokerEmail: "",

      brokerPhone: "",

      brokerClientReference:
        "",
    })
  }

  const handleCameraFile = async (
    event:
      React.ChangeEvent<HTMLInputElement>
  ) => {
    const file =
      event.target.files?.[0]

    event.target.value = ""

    if (!file) return

    await beginDocument(
      file,
      "camera"
    )
  }

  const handleDeviceFile = async (
    event:
      React.ChangeEvent<HTMLInputElement>
  ) => {
    const file =
      event.target.files?.[0]

    event.target.value = ""

    if (!file) return

    await beginDocument(
      file,
      "device"
    )
  }

  /* =======================================================
     BROKER RESOLUTION
  ======================================================= */

  const resolveBroker = ({
    brokerName,
    contactName,
    email,
    phone,
    clientReference,
  }: {
    brokerName: string
    contactName: string
    email: string
    phone: string
    clientReference: string
  }): BrokerSnapshot | undefined => {
    if (
      !brokerName.trim() &&
      !contactName.trim() &&
      !email.trim() &&
      !phone.trim()
    ) {
      return undefined
    }

    const organization =
      brokerName.trim()
        ? resolveOrganization(
            brokerName,
            "Insurance Broker"
          )
        : {
            organizationId:
              undefined,

            organizationName:
              "",
          }

    const contact =
      resolveBrokerContact({
        brokerOrganizationId:
          organization.organizationId,

        brokerOrganizationName:
          organization.organizationName,

        contactName,

        email,

        phone,
      })

    return {
      organizationId:
        organization.organizationId,

      organizationName:
        organization.organizationName ||
        brokerName.trim(),

      contactId:
        contact.contactId,

      contactName:
        contact.contactName,

      contactEmail:
        contact.contactEmail,

      contactPhone:
        contact.contactPhone,

      clientReference:
        clientReference.trim(),
    }
  }

  /* =======================================================
     DUPLICATE / RENEWAL LOGIC
  ======================================================= */

  const locatePolicyMatch = (
    draft:
      TransportationDraft,
    insurerName:
      string
  ) => {
    const insurer =
      normalizeCompanyName(
        insurerName
      )

    const policy =
      normalizeIdentifier(
        draft.policyNumber
      )

    const sameNumber =
      transportation.filter(
        (record) =>
          record.status !==
            "Archived" &&
          normalizeCompanyName(
            record.insurerName
          ) === insurer &&
          normalizeIdentifier(
            record.policyNumber
          ) === policy
      )

    const exactPeriod =
      sameNumber.find(
        (record) =>
          record.effectiveDate ===
            draft.effectiveDate &&
          record.expiryDate ===
            draft.expiryDate
      )

    if (exactPeriod) {
      return {
        type:
          "duplicate" as const,

        record:
          exactPeriod,
      }
    }

    if (sameNumber.length) {
      const mostRecent =
        [...sameNumber].sort(
          (a, b) =>
            b.expiryDate.localeCompare(
              a.expiryDate
            )
        )[0]

      return {
        type:
          "renewal" as const,

        record:
          mostRecent,
      }
    }

    return {
      type:
        "new" as const,

      record:
        undefined,
    }
  }

  /* =======================================================
     SAVE TRANSPORTATION RECORDS
  ======================================================= */

  const saveTransportationDrafts = ({
    drafts,
    source,
    evidence,
    broker,
  }: {
    drafts:
      TransportationDraft[]

    source: SourceType

    evidence?: InsuranceEvidence

    broker?: BrokerSnapshot
  }) => {
    const created:
      TransportationInsuranceRecord[] =
      []

    for (
      const draft of drafts
    ) {
      const insurer =
        resolveOrganization(
          draft.insurerName,

          "Insurance Company"
        )

      const resolvedName =
        insurer.organizationName

      const match =
        locatePolicyMatch(
          draft,
          resolvedName
        )

      /*
        Exact insurer + policy + policy period
        = same policy, do not duplicate.
      */

      if (
        match.type ===
        "duplicate"
      ) {
        continue
      }

      const timestamp =
        isoNow()

      const record:
        TransportationInsuranceRecord =
        {
          id: createId(
            "INS"
          ),

          family:
            "transportation",

          insuranceType:
            draft.insuranceType
              .trim(),

          canonicalType:
            normalizeInsuranceType(
              draft.insuranceType
            ),

          insurerOrganizationId:
            insurer.organizationId,

          insurerName:
            resolvedName,

          policyNumber:
            draft.policyNumber
              .trim(),

          effectiveDate:
            draft.effectiveDate,

          expiryDate:
            draft.expiryDate,

          coverage:
            draft.coverage
              .filter(
                (coverage) =>
                  coverage.label.trim() ||
                  coverage.value.trim()
              )
              .slice(
                0,
                6
              ),

          status:
            getExpiryStatus(
              draft.expiryDate,

              settings.expiryRules
            ),

          source,

          evidenceId:
            evidence?.id,

          broker,

          /*
            Same insurer + policy number but new policy
            period = renewal/history relationship.
          */

          previousRecordId:
            match.type ===
            "renewal"
              ? match.record?.id
              : undefined,

          createdAt:
            timestamp,

          updatedAt:
            timestamp,
        }

      created.push(record)
    }

    if (!created.length) {
      window.alert(
        "No new insurance records were created. The detected policy records already exist for the same insurer and policy period."
      )

      return
    }

    setData(
      (current) => ({
        ...current,

        transportation: [
          ...created,

          ...current.transportation,
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
  }

  const saveOCRWorkspace = (
    current: OCRWorkspace
  ) => {
    const evidence:
      InsuranceEvidence =
      {
        id: createId(
          "DOC"
        ),

        documentName:
          current.file.name,

        documentType:
          current.file.type,

        source:
          current.source,

        uploadedAt:
          isoNow(),

        ocrConfidence:
          current.confidence,

        dataUrl:
          current.dataUrl,
      }

    const broker =
      resolveBroker({
        brokerName:
          current.brokerName,

        contactName:
          current.brokerContactName,

        email:
          current.brokerEmail,

        phone:
          current.brokerPhone,

        clientReference:
          current.brokerClientReference,
      })

    saveTransportationDrafts({
      drafts:
        current.records,

      source: "OCR",

      evidence,

      broker,
    })

    setWorkspace(null)
  }

  const saveManualTransportation = (
    drafts:
      TransportationDraft[],

    brokerData: {
      brokerName: string
      contactName: string
      email: string
      phone: string
      clientReference: string
    }
  ) => {
    const broker =
      resolveBroker(
        brokerData
      )

    saveTransportationDrafts({
      drafts,

      source:
        "Manual",

      broker,
    })

    setManualTransportation(
      false
    )
  }

  /* =======================================================
     WORKERS
  ======================================================= */

  const saveWorkers = (
    draft:
      Omit<
        WorkersInsuranceRecord,
        | "id"
        | "status"
        | "createdAt"
        | "updatedAt"
      >
  ) => {
    const provider =
      resolveOrganization(
        draft.providerName,

        "Workers Insurance"
      )

    /*
      Strong duplicate:
      provider + account/policy # + same period.
    */

    const duplicate =
      workers.find(
        (record) =>
          record.status !==
            "Archived" &&
          normalizeCompanyName(
            record.providerName
          ) ===
            normalizeCompanyName(
              provider.organizationName
            ) &&
          normalizeIdentifier(
            record.policyNumber
          ) ===
            normalizeIdentifier(
              draft.policyNumber
            ) &&
          record.effectiveDate ===
            draft.effectiveDate &&
          record.expiryDate ===
            draft.expiryDate
      )

    if (duplicate) {
      window.alert(
        "This workers insurance/account record already exists."
      )

      return
    }

    const timestamp =
      isoNow()

    const record:
      WorkersInsuranceRecord =
      {
        ...draft,

        id: createId(
          "WCB"
        ),

        providerOrganizationId:
          provider.organizationId,

        providerName:
          provider.organizationName,

        status:
          getExpiryStatus(
            draft.expiryDate,

            settings.expiryRules
          ),

        createdAt:
          timestamp,

        updatedAt:
          timestamp,
      }

    setData(
      (current) => ({
        ...current,

        workers: [
          record,
          ...current.workers,
        ],
      })
    )

    setSimpleForm(null)
  }

  /* =======================================================
     BOND
  ======================================================= */

  const saveBond = (
    draft:
      Omit<
        BondRecord,
        | "id"
        | "status"
        | "createdAt"
        | "updatedAt"
      >
  ) => {
    const surety =
      resolveOrganization(
        draft.suretyName,

        "Insurance Company"
      )

    const duplicate =
      bonds.find(
        (record) =>
          record.status !==
            "Archived" &&
          normalizeIdentifier(
            record.bondNumber
          ) ===
            normalizeIdentifier(
              draft.bondNumber
            ) &&
          normalizeCompanyName(
            record.suretyName
          ) ===
            normalizeCompanyName(
              surety.organizationName
            )
      )

    if (duplicate) {
      window.alert(
        "This bond number already exists for the same surety company."
      )

      return
    }

    const timestamp =
      isoNow()

    const record:
      BondRecord =
      {
        ...draft,

        id: createId(
          "BND"
        ),

        suretyOrganizationId:
          surety.organizationId,

        suretyName:
          surety.organizationName,

        status:
          getExpiryStatus(
            draft.expiryDate,

            settings.expiryRules
          ),

        createdAt:
          timestamp,

        updatedAt:
          timestamp,
      }

    setData(
      (current) => ({
        ...current,

        bonds: [
          record,
          ...current.bonds,
        ],
      })
    )

    setSimpleForm(null)
  }

  /* =======================================================
     EDIT
  ======================================================= */

  const saveEditedTransportation = (
    edited:
      TransportationInsuranceRecord
  ) => {
    const insurer =
      resolveOrganization(
        edited.insurerName,

        "Insurance Company"
      )

    setData(
      (current) => ({
        ...current,

        transportation:
          current.transportation.map(
            (record) =>
              record.id ===
              edited.id
                ? {
                    ...edited,

                    insurerOrganizationId:
                      insurer.organizationId,

                    insurerName:
                      insurer.organizationName,

                    canonicalType:
                      normalizeInsuranceType(
                        edited.insuranceType
                      ),

                    status:
                      getExpiryStatus(
                        edited.expiryDate,

                        settings.expiryRules
                      ),

                    updatedAt:
                      isoNow(),
                  }
                : record
          ),
      })
    )

    setEditingTransportation(
      null
    )

    /*
      Future shared Master Register:
      field-level before/after values should be written here.
    */
  }

  /* =======================================================
     ARCHIVE
  ======================================================= */

  const confirmArchive = (
    reason: string
  ) => {
    if (!archiveTarget) return

    const timestamp =
      isoNow()

    if (
      archiveTarget.family ===
      "transportation"
    ) {
      setData(
        (current) => ({
          ...current,

          transportation:
            current.transportation.map(
              (record) =>
                record.id ===
                archiveTarget.id
                  ? {
                      ...record,

                      status:
                        "Archived",

                      archivedAt:
                        timestamp,

                      archivedBy:
                        "Current User",

                      archiveReason:
                        reason,

                      updatedAt:
                        timestamp,
                    }
                  : record
            ),
        })
      )
    }

    if (
      archiveTarget.family ===
      "workers"
    ) {
      setData(
        (current) => ({
          ...current,

          workers:
            current.workers.map(
              (record) =>
                record.id ===
                archiveTarget.id
                  ? {
                      ...record,

                      status:
                        "Archived",

                      archivedAt:
                        timestamp,

                      archivedBy:
                        "Current User",

                      archiveReason:
                        reason,

                      updatedAt:
                        timestamp,
                    }
                  : record
            ),
        })
      )
    }

    if (
      archiveTarget.family ===
      "bond"
    ) {
      setData(
        (current) => ({
          ...current,

          bonds:
            current.bonds.map(
              (record) =>
                record.id ===
                archiveTarget.id
                  ? {
                      ...record,

                      status:
                        "Archived",

                      archivedAt:
                        timestamp,

                      archivedBy:
                        "Current User",

                      archiveReason:
                        reason,

                      updatedAt:
                        timestamp,
                    }
                  : record
            ),
        })
      )
    }

    setArchiveTarget(null)
  }

  /* =======================================================
     STATES
  ======================================================= */

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
     PAGE
  ======================================================= */

  return (
    <>
      <div className="flex max-w-7xl flex-col gap-6 pb-12">
        {/* HEADER */}

        <div>
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
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
                Insurance & Bonds
              </h1>

              <p className="mt-1 text-sm text-muted-foreground">
                {company.name}{" "}
                <span className="font-mono text-xs">
                  ({company.id})
                </span>
              </p>
            </div>
          </div>

          {/* SOURCE COMPANY CONTEXT */}

          <div className="mt-5 rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Registered Origin
                </p>

                <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                  <Building2 className="size-3.5 text-primary" />

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

                <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                  <CheckCircle2 className="size-3.5 text-primary" />

                  {company.region ||
                    "Not specified"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border lg:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Renewal Rules
                </p>

                <button
                  type="button"
                  onClick={() =>
                    setSettings(
                      loadSystemSettings()
                    )
                  }
                  className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <RefreshCcw className="size-3" />

                  Portal Settings
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* OPERATIONAL POSITION */}

        <Card className="border-primary/15">
          <CardContent className="p-5">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Transportation Insurance Position
                </p>

                {activeTransportation.length >
                0 ? (
                  <>
                    <div className="mt-2 flex items-center gap-2">
                      <CheckCircle2 className="size-5 text-emerald-600" />

                      <p className="text-base font-semibold">
                        Active policy records on file
                      </p>
                    </div>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {activeTransportation.length} current transportation insurance record
                      {activeTransportation.length ===
                      1
                        ? ""
                        : "s"}{" "}
                      are available.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-2 flex items-center gap-2">
                      <AlertTriangle className="size-5 text-amber-600" />

                      <p className="text-base font-semibold">
                        No current transportation policy record
                      </p>
                    </div>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Scan the current COI or enter the active policy information manually.
                    </p>
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() =>
                    setShowSourcePicker(
                      true
                    )
                  }
                >
                  <ScanDocumentIcon
                    size={15}
                  />

                  <span className="ml-2">
                    Scan Insurance Document
                  </span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setManualTransportation(
                      true
                    )
                  }
                >
                  <Plus className="mr-2 size-4" />

                  Manual Entry
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* RENEWAL STATUS */}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatusCountCard
            label="Healthy"
            count={
              counts.healthy
            }
            status="Healthy"
          />

          <StatusCountCard
            label="Watch"
            count={
              counts.watch
            }
            status="Watch"
          />

          <StatusCountCard
            label="Urgent"
            count={
              counts.urgent
            }
            status="Urgent"
          />

          <StatusCountCard
            label="Critical"
            count={
              counts.critical
            }
            status="Critical"
          />

          <StatusCountCard
            label="Expired"
            count={
              counts.expired
            }
            status="Expired"
          />
        </div>

        {/* MANUAL TRANSPORTATION */}

        {manualTransportation && (
          <ManualTransportationForm
            existingRecords={
              transportation
            }
            onCancel={() =>
              setManualTransportation(
                false
              )
            }
            onSave={
              saveManualTransportation
            }
          />
        )}

        {/* TRANSPORTATION REGISTER */}

        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/20">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="size-4 text-primary" />

                  Transportation Insurance
                </CardTitle>

                <CardDescription className="mt-1 text-xs">
                  Each actual insurer/policy section is stored separately even when several appear on one COI.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {transportation.filter(
              (record) =>
                record.status !==
                "Archived"
            ).length === 0 ? (
              <div className="p-12 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ScanDocumentIcon
                    size={22}
                  />
                </div>

                <p className="mt-4 text-sm font-semibold">
                  No transportation insurance recorded
                </p>

                <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
                  Scan the COI first. One certificate can create several insurer/policy records while remaining linked to the same source evidence.
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {transportation
                  .filter(
                    (record) =>
                      record.status !==
                      "Archived"
                  )
                  .map(
                    (record) => (
                      <TransportationRecordRow
                        key={
                          record.id
                        }
                        record={
                          record
                        }
                        onEdit={() =>
                          setEditingTransportation(
                            record
                          )
                        }
                        onArchive={() =>
                          setArchiveTarget(
                            {
                              family:
                                "transportation",

                              id:
                                record.id,

                              label:
                                `${record.insuranceType} · ${record.policyNumber}`,
                            }
                          )
                        }
                      />
                    )
                  )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* WORKERS */}

        <Card className="overflow-visible">
          <CardHeader className="border-b bg-muted/20">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <HardHat className="size-4 text-primary" />

                  Workers Insurance
                </CardTitle>

                <CardDescription className="mt-1 text-xs">
                  Workers compensation, WCB / WSIB and occupational accident records remain separate from transportation insurance.
                </CardDescription>
              </div>

              <Button
                size="sm"
                onClick={() =>
                  setSimpleForm(
                    "workers"
                  )
                }
              >
                <Plus className="mr-1.5 size-4" />

                Add Record
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {simpleForm ===
              "workers" && (
              <div className="p-4">
                <SimpleRecordForm
                  family="workers"
                  company={
                    company
                  }
                  onCancel={() =>
                    setSimpleForm(
                      null
                    )
                  }
                  onSaveWorkers={
                    saveWorkers
                  }
                  onSaveBond={() => {}}
                />
              </div>
            )}

            {workers.filter(
              (record) =>
                record.status !==
                "Archived"
            ).length === 0 ? (
              <div className="p-10 text-center">
                <HardHat className="mx-auto size-9 text-muted-foreground/30" />

                <p className="mt-3 text-sm font-medium">
                  No active workers insurance records
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {workers
                  .filter(
                    (record) =>
                      record.status !==
                      "Archived"
                  )
                  .map(
                    (record) => (
                      <WorkersRow
                        key={
                          record.id
                        }
                        record={
                          record
                        }
                        onArchive={() =>
                          setArchiveTarget(
                            {
                              family:
                                "workers",

                              id:
                                record.id,

                              label:
                                `${record.insuranceType} · ${record.policyNumber}`,
                            }
                          )
                        }
                      />
                    )
                  )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* BONDS */}

        <Card className="overflow-visible">
          <CardHeader className="border-b bg-muted/20">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileKey2 className="size-4 text-primary" />

                  Surety Bonds
                </CardTitle>

                <CardDescription className="mt-1 text-xs">
                  Customs, broker, fuel-tax and other surety obligations.
                </CardDescription>
              </div>

              <Button
                size="sm"
                onClick={() =>
                  setSimpleForm(
                    "bond"
                  )
                }
              >
                <Plus className="mr-1.5 size-4" />

                Add Bond
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {simpleForm ===
              "bond" && (
              <div className="p-4">
                <SimpleRecordForm
                  family="bond"
                  company={
                    company
                  }
                  onCancel={() =>
                    setSimpleForm(
                      null
                    )
                  }
                  onSaveWorkers={() => {}}
                  onSaveBond={
                    saveBond
                  }
                />
              </div>
            )}

            {bonds.filter(
              (record) =>
                record.status !==
                "Archived"
            ).length === 0 ? (
              <div className="p-10 text-center">
                <FileKey2 className="mx-auto size-9 text-muted-foreground/30" />

                <p className="mt-3 text-sm font-medium">
                  No active surety bonds
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {bonds
                  .filter(
                    (record) =>
                      record.status !==
                      "Archived"
                  )
                  .map(
                    (record) => (
                      <BondRow
                        key={
                          record.id
                        }
                        record={
                          record
                        }
                        onArchive={() =>
                          setArchiveTarget(
                            {
                              family:
                                "bond",

                              id:
                                record.id,

                              label:
                                `${record.bondType} · ${record.bondNumber}`,
                            }
                          )
                        }
                      />
                    )
                  )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ARCHIVED */}

        {[
          ...transportation,
          ...workers,
          ...bonds,
        ].some(
          (record) =>
            record.status ===
            "Archived"
        ) && (
          <Card>
            <CardHeader className="border-b bg-muted/20">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Archive className="size-4 text-muted-foreground" />

                Archived Records
              </CardTitle>

              <CardDescription className="text-xs">
                Historical records remain retained and are never deleted.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-2 p-4">
              {transportation
                .filter(
                  (record) =>
                    record.status ===
                    "Archived"
                )
                .map(
                  (record) => (
                    <div
                      key={
                        record.id
                      }
                      className="rounded-lg border p-3 opacity-70"
                    >
                      <p className="text-xs font-semibold">
                        {
                          record.insuranceType
                        }
                      </p>

                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {
                          record.insurerName
                        }{" "}
                        ·{" "}
                        {
                          record.policyNumber
                        }{" "}
                        · archived{" "}
                        {
                          record.archivedAt
                            ? new Date(
                                record.archivedAt
                              ).toLocaleDateString()
                            : ""
                        }
                      </p>

                      {record.archiveReason && (
                        <p className="mt-1 text-[10px]">
                          Reason:{" "}
                          {
                            record.archiveReason
                          }
                        </p>
                      )}
                    </div>
                  )
                )}
            </CardContent>
          </Card>
        )}

        {/* INTEGRITY */}

        <Card className="border-dashed bg-muted/10">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <History className="size-4" />
              </div>

              <div>
                <p className="text-xs font-semibold">
                  Insurance record integrity
                </p>

                <p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">
                  OCR and manual entry create the same underlying record structure. Insurers, brokers and broker contacts are resolved against existing TES identities before new entities are created. Records are archived rather than deleted, and expiry status is controlled by the portal-wide renewal rules.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SOURCE PICKER */}

      {showSourcePicker && (
        <DocumentSourcePicker
          onClose={() =>
            setShowSourcePicker(
              false
            )
          }
          onCamera={() => {
            setShowSourcePicker(
              false
            )

            cameraInputRef.current?.click()
          }}
          onDevice={() => {
            setShowSourcePicker(
              false
            )

            deviceInputRef.current?.click()
          }}
        />
      )}

      {/* OCR WORKSPACE */}

      {workspace && (
        <TransportationWorkspace
          workspace={
            workspace
          }
          setWorkspace={
            setWorkspace
          }
          existingRecords={
            transportation
          }
          onCancel={() =>
            setWorkspace(null)
          }
          onReplaceDocument={() => {
            setWorkspace(null)

            setShowSourcePicker(
              true
            )
          }}
          onSave={
            saveOCRWorkspace
          }
        />
      )}

      {/* EDIT */}

      {editingTransportation && (
        <EditTransportationModal
          record={
            editingTransportation
          }
          onCancel={() =>
            setEditingTransportation(
              null
            )
          }
          onSave={
            saveEditedTransportation
          }
        />
      )}

      {/* ARCHIVE */}

      {archiveTarget && (
        <ArchiveDialog
          label={
            archiveTarget.label
          }
          onCancel={() =>
            setArchiveTarget(
              null
            )
          }
          onConfirm={
            confirmArchive
          }
        />
      )}

      {/* CAMERA */}

      <input
        ref={
          cameraInputRef
        }
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={
          handleCameraFile
        }
      />

      {/* DEVICE */}

      <input
        ref={
          deviceInputRef
        }
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={
          handleDeviceFile
        }
      />
    </>
  )
}

/* =========================================================
   STATUS SUMMARY
========================================================= */

function StatusCountCard({
  label,
  count,
  status,
}: {
  label: string
  count: number
  status: ExpiryStatus
}) {
  const style =
    statusStyle(status)

  return (
    <Card
      className={`border-l-4 ${style.accent}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {label}
          </p>

          <ExpiryBadge
            status={status}
          />
        </div>

        <p className="mt-2 text-2xl font-bold">
          {count}
        </p>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   LEGACY MIGRATION

   Old page used:
   {
     type,
     number,
     company,
     broker,
     limits,
     principal,
     amount,
     effective,
     expiry,
     source...
   }

   We keep existing testing data rather than wiping it.
========================================================= */

function migrateLegacyRecords(
  legacy: any[]
): StoredInsuranceData {
  const result:
    StoredInsuranceData =
    {
      ...EMPTY_DATA,

      transportation: [],
      workers: [],
      bonds: [],
      evidence: [],
    }

  for (
    const record of legacy
  ) {
    const timestamp =
      record.createdAt ||
      isoNow()

    if (
      [
        "WSIB",
        "WCB",
        "Workers Compensation",
        "Occupational Accident",
      ].includes(
        record.type
      )
    ) {
      result.workers.push({
        id:
          record.id ||
          createId("WCB"),

        family:
          "workers",

        insuranceType:
          record.type,

        providerName:
          record.company ||
          "",

        policyNumber:
          record.number ||
          "",

        effectiveDate:
          record.effective ||
          "",

        expiryDate:
          record.expiry ||
          "",

        coverage:
          record.limits
            ? [
                {
                  id: createId(
                    "COV"
                  ),

                  label:
                    "Coverage",

                  value:
                    record.limits,
                },
              ]
            : [],

        status:
          record.status ===
          "Archived"
            ? "Archived"
            : "Healthy",

        source:
          record.source ||
          "Manual",

        createdAt:
          timestamp,

        updatedAt:
          timestamp,

        archivedAt:
          record.archivedAt,
      })

      continue
    }

    if (
      [
        "US Customs Continuous",
        "Freight Broker BMC-84",
        "Performance Bond",
      ].includes(
        record.type
      )
    ) {
      result.bonds.push({
        id:
          record.id ||
          createId("BND"),

        family: "bond",

        bondType:
          record.type,

        suretyName:
          record.company ||
          "",

        bondNumber:
          record.number ||
          "",

        principalName:
          record.principal ||
          "",

        bondAmount:
          record.amount,

        effectiveDate:
          record.effective ||
          "",

        expiryDate:
          record.expiry,

        status:
          record.status ===
          "Archived"
            ? "Archived"
            : "Healthy",

        source:
          record.source ||
          "Manual",

        createdAt:
          timestamp,

        updatedAt:
          timestamp,

        archivedAt:
          record.archivedAt,
      })

      continue
    }

    result.transportation.push({
      id:
        record.id ||
        createId("INS"),

      family:
        "transportation",

      insuranceType:
        record.type ||
        "Other",

      canonicalType:
        normalizeInsuranceType(
          record.type ||
            "Other"
        ),

      insurerName:
        record.company ||
        "",

      policyNumber:
        record.number ||
        "",

      effectiveDate:
        record.effective ||
        "",

      expiryDate:
        record.expiry ||
        "",

      coverage:
        record.limits
          ? [
              {
                id: createId(
                  "COV"
                ),

                label:
                  "Coverage Limit",

                value:
                  record.limits,
              },
            ]
          : [],

      status:
        record.status ===
        "Archived"
          ? "Archived"
          : "Healthy",

      source:
        record.source ||
        "Manual",

      broker:
        record.broker
          ? {
              organizationName:
                record.broker,
            }
          : undefined,

      createdAt:
        timestamp,

      updatedAt:
        timestamp,

      archivedAt:
        record.archivedAt,
    })
  }

  return result
}
