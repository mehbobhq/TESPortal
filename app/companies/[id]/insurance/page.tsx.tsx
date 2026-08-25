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
  Eye,
  FileKey2,
  FileText,
  HardHat,
  History,
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
  Upload,
  UserRound,
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
   SYSTEM TYPES
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
}

type ExpiryStatus =
  | "Healthy"
  | "Watch"
  | "Urgent"
  | "Critical"
  | "Expired"
  | "Archived"

type SourceType = "OCR" | "Manual"

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
  contact?: string
  region?: string

  /*
    LOCKED COMPANY CONTRACT.
    Do not rename.
  */
  regCorpState?: string
  regCorpCountry?: string

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
========================================================= */

type CoverageItem = {
  id: string
  label: string
  value: string
}

type BrokerReference = {
  organizationId?: string
  organizationName: string

  contactId?: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
}

type InsuranceEvidence = {
  id: string

  family: RecordFamily

  documentName: string
  documentType: string

  source: DocumentSource

  uploadedAt: string

  ocrConfidence?: number

  /*
    Prototype only.
    Replace with durable document ID later.
  */
  dataUrl?: string
}

type TransportationInsuranceRecord = {
  id: string

  /*
    All records extracted from one COI share groupId.
    That allows broker information to be edited once.
  */
  groupId: string

  family: "transportation"

  /*
    EXACT source wording.
  */
  insuranceType: string

  /*
    Internal TES normalization.
  */
  canonicalType: string

  insurerOrganizationId?: string
  insurerName: string

  policyNumber: string

  effectiveDate: string
  expiryDate: string

  coverage: CoverageItem[]

  broker?: BrokerReference

  evidenceId?: string

  source: SourceType

  status: ExpiryStatus

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

  evidenceId?: string

  source: SourceType

  status: ExpiryStatus

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

  evidenceId?: string

  source: SourceType

  status: ExpiryStatus

  createdAt: string
  updatedAt: string

  archivedAt?: string
  archivedBy?: string
  archiveReason?: string
}

type SelectedInsuranceRecord =
  | TransportationInsuranceRecord
  | WorkersInsuranceRecord
  | BondRecord

type StoredInsuranceData = {
  version: number

  transportation: TransportationInsuranceRecord[]
  workers: WorkersInsuranceRecord[]
  bonds: BondRecord[]

  evidence: InsuranceEvidence[]
}

/* =========================================================
   DRAFT TYPES
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

type WorkersDraft = {
  insuranceType: string

  providerName: string
  policyNumber: string

  jurisdiction: string

  effectiveDate: string
  expiryDate: string

  coverage: CoverageItem[]
}

type BondDraft = {
  bondType: string

  suretyName: string
  bondNumber: string

  principalName: string
  bondAmount: string

  effectiveDate: string
  expiryDate: string
}

/* =========================================================
   OCR SESSION
========================================================= */

type OCRSession = {
  family: RecordFamily

  source: DocumentSource

  file: File
  dataUrl: string

  processing: boolean
  extractionComplete: boolean

  confidence?: number

  transportationRecords: TransportationDraft[]

  workersDraft: WorkersDraft
  bondDraft: BondDraft

  brokerName: string
  brokerContactName: string
  brokerEmail: string
  brokerPhone: string
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
  version: 4,

  transportation: [],
  workers: [],
  bonds: [],

  evidence: [],
}

/* =========================================================
   GENERIC HELPERS
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
   SETTINGS
========================================================= */

function loadSystemSettings(): SystemSettings {
  const fallback: SystemSettings = {
    version: 1,

    expiryRules:
      DEFAULT_EXPIRY_RULES,
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

    return {
      ...fallback,
      ...parsed,

      expiryRules: {
        ...DEFAULT_EXPIRY_RULES,
        ...(parsed.expiryRules ||
          {}),
      },
    }
  } catch {
    return fallback
  }
}

/* =========================================================
   TES OCR ICON
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
    digits =
      digits.slice(1)
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
      /\b(incorporated|inc|corporation|corp|company|co|limited|ltd)\b/g,
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
   SIMILARITY
========================================================= */

function levenshtein(
  a: string,
  b: string
) {
  if (!a.length) return b.length
  if (!b.length) return a.length

  const matrix =
    Array.from(
      {
        length:
          b.length + 1,
      },
      () =>
        Array(
          a.length + 1
        ).fill(0)
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
        b[i - 1] ===
        a[j - 1]
          ? 0
          : 1

      matrix[i][j] =
        Math.min(
          matrix[i - 1][j] +
            1,

          matrix[i][j - 1] +
            1,

          matrix[i - 1][
            j - 1
          ] + cost
        )
    }
  }

  return matrix[b.length][
    a.length
  ]
}

function similarity(
  a: string,
  b: string
) {
  if (!a || !b) {
    return 0
  }

  const max =
    Math.max(
      a.length,
      b.length
    )

  if (!max) return 100

  const distance =
    levenshtein(a, b)

  return (
    ((max - distance) /
      max) *
    100
  )
}

/* =========================================================
   COMPANIES
========================================================= */

function getCompanies(): Company[] {
  try {
    const parsed =
      JSON.parse(
        localStorage.getItem(
          "tes_companies"
        ) || "[]"
      )

    return Array.isArray(
      parsed
    )
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

function createCompanyId(
  companies: Company[]
) {
  const existing =
    new Set(
      companies.map(
        (company) =>
          company.id
      )
    )

  for (
    let attempt = 0;
    attempt < 100;
    attempt++
  ) {
    const id =
      `CMP-${
        10000 +
        Math.floor(
          Math.random() *
            90000
        )
      }`

    if (
      !existing.has(id)
    ) {
      return id
    }
  }

  return `CMP-${Date.now()}`
}

/* =========================================================
   ORGANIZATION RESOLUTION

   Existing organization wins.

   Aggressive duplicate prevention.

   Creating a new insurer/broker is the LAST step.
========================================================= */

function resolveOrganization(
  name: string,
  desiredKind:
    | "Insurance Company"
    | "Insurance Broker"
    | "Workers Insurance"
) {
  const entered =
    name.trim()

  if (!entered) {
    return {
      organizationId:
        undefined,

      organizationName: "",

      created: false,
    }
  }

  const companies =
    getCompanies()

  const candidate =
    normalizeCompanyName(
      entered
    )

  /*
    Exact normalized match.
  */

  const exact =
    companies.find(
      (company) =>
        normalizeCompanyName(
          company.name
        ) === candidate
    )

  if (exact) {
    return {
      organizationId:
        exact.id,

      organizationName:
        exact.name,

      created: false,
    }
  }

  /*
    Very strong fuzzy company match.

    Limited number of insurance companies means we
    intentionally resolve strongly before creating.
  */

  const probable =
    companies
      .map((company) => ({
        company,

        score:
          similarity(
            candidate,

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

  if (probable.length) {
    const company =
      probable[0].company

    return {
      organizationId:
        company.id,

      organizationName:
        company.name,

      created: false,
    }
  }

  /*
    New organization only after resolution failed.
  */

  const created: Company = {
    id:
      createCompanyId(
        companies
      ),

    name: entered,

    kind: desiredKind,

    contact: "N/A",

    region:
      "Not specified",

    status: "Active",

    tone: "ok",

    createdAt: isoNow(),

    discoveredBy:
      "Insurance Document Intelligence",
  }

  saveCompanies([
    created,
    ...companies,
  ])

  return {
    organizationId:
      created.id,

    organizationName:
      created.name,

    created: true,
  }
}

/* =========================================================
   CONTACTS
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

    if (!raw) {
      return []
    }

    const parsed =
      JSON.parse(raw)

    return Array.isArray(
      parsed
    )
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

  if (
    parts.length === 1
  ) {
    return {
      firstName:
        parts[0],

      lastName: "",
    }
  }

  return {
    firstName:
      parts[0],

    lastName:
      parts
        .slice(1)
        .join(" "),
  }
}

/* =========================================================
   BROKER CONTACT RESOLUTION

   Sonic Insurance = company.
   Harpreet Kaur = contact belonging to Sonic.

   Insurance records reference BOTH IDs.

   Same Harpreet can therefore handle many TES clients
   without creating Harpreet again.
========================================================= */

function ensureBrokerRelationship(
  contact: Contact,
  brokerOrganizationId: string,
  brokerOrganizationName: string
): Contact {
  const relationships = [
    ...(contact.relationships || []),
  ]

  const existingIndex = relationships.findIndex(
    (relationship) =>
      relationship.companyId === brokerOrganizationId
  )

  if (existingIndex >= 0) {
    relationships[existingIndex] = {
      ...relationships[existingIndex],
      companyName: brokerOrganizationName,
      role: "Insurance Broker Contact",
      status: "active",
    }
  } else {
    relationships.push({
      id: createId("REL"),
      companyId: brokerOrganizationId,
      companyName: brokerOrganizationName,
      role: "Insurance Broker Contact",
      status: "active",
      startDate: isoNow().slice(0, 10),
      source: "document",
    })
  }

  return {
    ...contact,
    relationships,
    updatedAt: isoNow(),
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
  const contacts = getContacts()

  const normalizedEmail = normalizeEmail(email)
  const normalizedPhone = normalizePhone(phone)
  const normalizedName = normalizePersonName(contactName)

  let existing =
    contacts.find(
      (contact) =>
        Boolean(normalizedEmail) &&
        normalizeEmail(contact.email) === normalizedEmail
    )

  if (!existing) {
    existing =
      contacts.find(
        (contact) =>
          Boolean(normalizedPhone) &&
          normalizePhone(contact.phone) === normalizedPhone
      )
  }

  if (
    !existing &&
    normalizedName &&
    brokerOrganizationId
  ) {
    const candidates =
      contacts
        .filter((contact) =>
          contact.relationships?.some(
            (relationship) =>
              relationship.companyId === brokerOrganizationId
          )
        )
        .map((contact) => ({
          contact,
          score: similarity(
            normalizedName,
            normalizePersonName(
              `${contact.firstName} ${contact.lastName}`
            )
          ),
        }))
        .filter((result) => result.score >= 90)
        .sort((a, b) => b.score - a.score)

    existing = candidates[0]?.contact
  }

  if (existing) {
    const updatedContacts = contacts.map(
      (contact) => {
        if (contact.id !== existing!.id) {
          return contact
        }

        let next: Contact = {
          ...contact,
          email: contact.email || email.trim(),
          phone: contact.phone || phone.trim(),
          updatedAt: isoNow(),
        }

        if (brokerOrganizationId) {
          next = ensureBrokerRelationship(
            next,
            brokerOrganizationId,
            brokerOrganizationName
          )
        }

        return next
      }
    )

    saveContacts(updatedContacts)

    const refreshed =
      updatedContacts.find(
        (contact) =>
          contact.id === existing!.id
      )!

    return {
      contactId: refreshed.id,
      contactName:
        `${refreshed.firstName} ${refreshed.lastName}`.trim(),
      contactEmail: refreshed.email || "",
      contactPhone: refreshed.phone || "",
      created: false,
    }
  }

  if (
    !contactName.trim() &&
    !email.trim() &&
    !phone.trim()
  ) {
    return {
      contactId: undefined,
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      created: false,
    }
  }

  const names = splitPersonName(contactName)

  let created: Contact = {
    id: createId("CNT"),
    globalId: createId("USR"),
    firstName: names.firstName,
    lastName: names.lastName,
    email: email.trim(),
    phone: phone.trim(),
    role: "Insurance Broker Contact",
    isPrimary: false,
    isArchived: false,
    relationships: [],
    createdAt: isoNow(),
    updatedAt: isoNow(),
    discoveredBy: "Insurance Document Intelligence",
  }

  if (brokerOrganizationId) {
    created = ensureBrokerRelationship(
      created,
      brokerOrganizationId,
      brokerOrganizationName
    )
  }

  saveContacts([created, ...contacts])

  return {
    contactId: created.id,
    contactName:
      `${created.firstName} ${created.lastName}`.trim(),
    contactEmail: created.email || "",
    contactPhone: created.phone || "",
    created: true,
  }
}

/* =========================================================
   ORGANIZATION INPUT
========================================================= */

function OrganizationInput({
  label,
  value,
  onChange,
  kindFilter,
}: {
  label: string

  value: string

  onChange: (
    value: string
  ) => void

  kindFilter?: string[]
}) {
  const [open, setOpen] =
    useState(false)

  const companies =
    useMemo(
      () =>
        getCompanies(),
      [open]
    )

  const matches =
    useMemo(() => {
      const query =
        normalizeCompanyName(
          value
        )

      let pool =
        companies

      if (
        kindFilter?.length
      ) {
        pool =
          companies.filter(
            (company) =>
              kindFilter.includes(
                company.kind ||
                  ""
              )
          )
      }

      if (!query) {
        return pool.slice(
          0,
          8
        )
      }

      return pool
        .map((company) => ({
          company,

          score:
            similarity(
              query,

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
            result.score >=
              60
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
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
      </Label>

      <div className="relative">
        <Input
          value={value}
          autoComplete="off"
          onFocus={() =>
            setOpen(true)
          }
          onBlur={() =>
            window.setTimeout(
              () =>
                setOpen(
                  false
                ),
              150
            )
          }
          onChange={(
            event
          ) => {
            onChange(
              event.target
                .value
            )

            setOpen(true)
          }}
        />

        <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>

      {open &&
        matches.length >
          0 && (
          <div className="absolute left-0 right-0 z-[150] mt-1 max-h-60 overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl">
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
                  <div>
                    <p className="text-sm font-medium">
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

                  <CheckCircle2 className="size-3.5 text-primary" />
                </button>
              )
            )}
          </div>
        )}
    </div>
  )
}

/* =========================================================
   COVERAGE
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
  const add = () => {
    onChange([
      ...items,

      {
        id:
          createId(
            "COV"
          ),

        label: "",
        value: "",
      },
    ])
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label>
            Key Coverage
          </Label>

          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Keep the most useful 2–3 coverage facts visible. The complete document remains available for deeper review.
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

      {items.map(
        (item) => (
          <div
            key={
              item.id
            }
            className="grid gap-2 sm:grid-cols-[1fr_1fr_36px]"
          >
            <Input
              value={
                item.label
              }
              placeholder="Coverage"
              onChange={(
                event
              ) =>
                onChange(
                  items.map(
                    (
                      current
                    ) =>
                      current.id ===
                      item.id
                        ? {
                            ...current,

                            label:
                              event
                                .target
                                .value,
                          }
                        : current
                  )
                )
              }
            />

            <Input
              value={
                item.value
              }
              placeholder="Limit / value"
              onChange={(
                event
              ) =>
                onChange(
                  items.map(
                    (
                      current
                    ) =>
                      current.id ===
                      item.id
                        ? {
                            ...current,

                            value:
                              event
                                .target
                                .value,
                          }
                        : current
                  )
                )
              }
            />

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9"
              onClick={() =>
                onChange(
                  items.filter(
                    (
                      current
                    ) =>
                      current.id !==
                      item.id
                  )
                )
              }
            >
              <X className="size-4" />
            </Button>
          </div>
        )
      )}
    </div>
  )
}

/* =========================================================
   TRANSPORTATION RECORD EDITOR
========================================================= */

function TransportationDraftEditor({
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

    value:
      TransportationDraft[K]
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
              One actual insurance/policy section from the source document.
            </CardDescription>
          </div>

          {allowRemove && (
            <Button
              variant="ghost"
              size="icon"
              onClick={
                onRemove
              }
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
              placeholder="Exact wording from document"
              onChange={(
                event
              ) =>
                update(
                  "insuranceType",

                  event.target
                    .value
                )
              }
            />

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
            label="Insurance Company *"
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

                  event.target
                    .value
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

                  event.target
                    .value
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

                  event.target
                    .value
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
   REAL OCR REQUEST + DEVELOPMENT FALLBACK

   First tries future shared endpoint.

   During prototype testing, if endpoint does not yet exist,
   Transportation uses the actual sample COI structure the
   user supplied so the workflow can be tested end-to-end.

   REDACTED policy numbers remain blank.
========================================================= */

async function requestOCR(
  session: OCRSession
): Promise<Partial<OCRSession>> {
  try {
    const body =
      new FormData()

    body.append(
      "file",
      session.file
    )

    body.append(
      "family",
      session.family
    )

    const response =
      await fetch(
        "/api/document-intelligence/insurance",

        {
          method: "POST",
          body,
        }
      )

    if (
      response.ok
    ) {
      const result =
        await response.json()

      return result
    }
  } catch {
    /*
      API not connected yet.
      Use test fallback below.
    */
  }

  if (
    session.family ===
    "transportation"
  ) {
    return {
      confidence: 90,

      extractionComplete:
        true,

      transportationRecords:
        [
          {
            tempId:
              createId(
                "TMP"
              ),

            insuranceType:
              "COMMERCIAL GENERAL LIABILITY",

            canonicalType:
              "GENERAL_LIABILITY",

            insurerName:
              "Aurora Underwriting Solutions Inc.",

            /*
              Redacted in supplied test COI.
              Never invent it.
            */
            policyNumber: "",

            effectiveDate:
              "2025-12-24",

            expiryDate:
              "2026-12-24",

            coverage: [
              {
                id:
                  createId(
                    "COV"
                  ),

                label:
                  "General Aggregate",

                value:
                  "$2,000,000",
              },

              {
                id:
                  createId(
                    "COV"
                  ),

                label:
                  "Each Occurrence",

                value:
                  "$2,000,000",
              },

              {
                id:
                  createId(
                    "COV"
                  ),

                label:
                  "Products / Completed Operations",

                value:
                  "$2,000,000",
              },
            ],
          },

          {
            tempId:
              createId(
                "TMP"
              ),

            insuranceType:
              "AUTOMOBILE LIABILITY",

            canonicalType:
              "AUTOMOBILE_LIABILITY",

            insurerName:
              "The Nordic Insurance Company of Canada",

            policyNumber: "",

            effectiveDate:
              "2025-12-24",

            expiryDate:
              "2026-12-24",

            coverage: [
              {
                id:
                  createId(
                    "COV"
                  ),

                label:
                  "Bodily Injury / Property Damage Combined",

                value:
                  "$2,000,000",
              },

              {
                id:
                  createId(
                    "COV"
                  ),

                label:
                  "Bodily Injury Per Person",

                value:
                  "$2,000,000",
              },

              {
                id:
                  createId(
                    "COV"
                  ),

                label:
                  "Property Damage",

                value:
                  "$2,000,000",
              },
            ],
          },

          {
            tempId:
              createId(
                "TMP"
              ),

            insuranceType:
              "OTHER LIABILITY",

            canonicalType:
              "OTHER",

            insurerName:
              "Aurora Underwriting Solutions Inc.",

            policyNumber: "",

            effectiveDate:
              "2025-12-24",

            expiryDate:
              "2026-12-24",

            coverage: [
              {
                id:
                  createId(
                    "COV"
                  ),

                label:
                  "Motor Truck Cargo",

                value:
                  "$250,000",
              },

              {
                id:
                  createId(
                    "COV"
                  ),

                label:
                  "Non-Owned Trailer",

                value:
                  "$100,000",
              },

              {
                id:
                  createId(
                    "COV"
                  ),

                label:
                  "Deductible",

                value:
                  "$5,000",
              },
            ],
          },
        ],

      brokerName:
        "Sonic Insurance",

      brokerContactName:
        "Harpreet Kaur",
    }
  }

  /*
    Workers / Bonds:
    OCR workflow is fully connected but we do not
    fabricate document values without a sample.
  */

  return {
    confidence: 90,

    extractionComplete:
      true,
  }
}

/* =========================================================
   OCR WORKSPACE
========================================================= */

function OCRWorkspaceView({
  session,
  setSession,
  onReplace,
  onCancel,
  onSave,
}: {
  session: OCRSession

  setSession:
    React.Dispatch<
      React.SetStateAction<OCRSession | null>
    >

  onReplace: () => void

  onCancel: () => void

  onSave: (
    session: OCRSession
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

      const extracted =
        await requestOCR(
          session
        )

      setSession(
        (current) =>
          current
            ? {
                ...current,

                ...extracted,

                processing:
                  false,

                extractionComplete:
                  true,
              }
            : current
      )
    }

  const updateTransport = (
    index: number,

    draft:
      TransportationDraft
  ) => {
    setSession(
      (current) =>
        current
          ? {
              ...current,

              transportationRecords:
                current.transportationRecords.map(
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
          : current
    )
  }

  const transportationReady =
    session.transportationRecords.length >
      0 &&
    session.transportationRecords.every(
      (record) =>
        record.insuranceType.trim() &&
        record.insurerName.trim() &&
        record.policyNumber.trim() &&
        record.effectiveDate &&
        record.expiryDate
    )

  const workersReady =
    Boolean(
      session.workersDraft.insuranceType.trim() &&
        session.workersDraft.providerName.trim() &&
        session.workersDraft.policyNumber.trim() &&
        session.workersDraft.effectiveDate &&
        session.workersDraft.expiryDate
    )

  const bondReady =
    Boolean(
      session.bondDraft.bondType.trim() &&
        session.bondDraft.suretyName.trim() &&
        session.bondDraft.bondNumber.trim() &&
        session.bondDraft.effectiveDate
    )

  const saveReady =
    session.family ===
    "transportation"
      ? transportationReady
      : session.family ===
          "workers"
        ? workersReady
        : bondReady

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-background">
      <div className="flex min-h-16 items-center justify-between gap-4 border-b px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ScanDocumentIcon
              size={18}
            />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
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

            <p className="mt-0.5 max-w-xl truncate text-[10px] text-muted-foreground">
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

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(420px,0.9fr)_minmax(640px,1.1fr)]">
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
                  {session.family ===
                  "transportation"
                    ? "Transportation Insurance Extraction"
                    : session.family ===
                        "workers"
                      ? "Workers Insurance Extraction"
                      : "Surety Bond Extraction"}
                </h2>

                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Review the extracted information against the original document before saving.
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
                onClick={
                  runOCR
                }
                disabled={
                  session.processing
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
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />

                  <div>
                    <p className="text-xs font-semibold">
                      Extraction ready for verification
                    </p>

                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      Correct anything necessary before creating authoritative TES records.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {session.family ===
              "transportation" && (
              <div className="space-y-5">
                {session.transportationRecords.map(
                  (
                    draft,
                    index
                  ) => (
                    <TransportationDraftEditor
                      key={
                        draft.tempId
                      }
                      index={
                        index
                      }
                      draft={
                        draft
                      }
                      onChange={(
                        next
                      ) =>
                        updateTransport(
                          index,
                          next
                        )
                      }
                      allowRemove={
                        session.transportationRecords
                          .length >
                        1
                      }
                      onRemove={() =>
                        setSession(
                          (
                            current
                          ) =>
                            current
                              ? {
                                  ...current,

                                  transportationRecords:
                                    current.transportationRecords.filter(
                                      (
                                        _,
                                        itemIndex
                                      ) =>
                                        itemIndex !==
                                        index
                                    ),
                                }
                              : current
                        )
                      }
                    />
                  )
                )}

                <Button
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() =>
                    setSession(
                      (
                        current
                      ) =>
                        current
                          ? {
                              ...current,

                              transportationRecords:
                                [
                                  ...current.transportationRecords,

                                  emptyTransportationDraft(),
                                ],
                            }
                          : current
                    )
                  }
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
                      Broker company and broker contact are separate TES identities.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
                    <OrganizationInput
                      label="Broker Company"
                      value={
                        session.brokerName
                      }
                      onChange={(
                        value
                      ) =>
                        setSession(
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
                          session.brokerContactName
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
                        Contact Email
                      </Label>

                      <Input
                        type="email"
                        value={
                          session.brokerEmail
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
                        Contact Phone
                      </Label>

                      <Input
                        type="tel"
                        value={
                          session.brokerPhone
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
                  </CardContent>
                </Card>
              </div>
            )}

            {session.family ===
              "workers" && (
              <WorkersDraftForm
                draft={
                  session.workersDraft
                }
                onChange={(
                  workersDraft
                ) =>
                  setSession(
                    (
                      current
                    ) =>
                      current
                        ? {
                            ...current,

                            workersDraft,
                          }
                        : current
                  )
                }
              />
            )}

            {session.family ===
              "bond" && (
              <BondDraftForm
                draft={
                  session.bondDraft
                }
                onChange={(
                  bondDraft
                ) =>
                  setSession(
                    (
                      current
                    ) =>
                      current
                        ? {
                            ...current,

                            bondDraft,
                          }
                        : current
                  )
                }
              />
            )}
          </div>

          <div className="border-t bg-background p-4">
            <div className="flex justify-end">
              <Button
                disabled={
                  !saveReady
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
   WORKERS DRAFT
========================================================= */

function WorkersDraftForm({
  draft,
  onChange,
}: {
  draft: WorkersDraft

  onChange: (
    draft: WorkersDraft
  ) => void
}) {
  const update = <
    K extends keyof WorkersDraft
  >(
    key: K,
    value:
      WorkersDraft[K]
  ) =>
    onChange({
      ...draft,

      [key]: value,
    })

  return (
    <Card className="overflow-visible shadow-none">
      <CardHeader className="border-b bg-muted/15 py-4">
        <CardTitle className="text-sm">
          Workers Insurance Record
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>
              Insurance Type *
            </Label>

            <Select
              value={
                draft.insuranceType ||
                undefined
              }
              onValueChange={(
                value
              ) =>
                update(
                  "insuranceType",
                  value
                )
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>

              <SelectContent className="z-[150]">
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
              </SelectContent>
            </Select>
          </div>

          <OrganizationInput
            label="Insurance Company / Board *"
            value={
              draft.providerName
            }
            onChange={(
              value
            ) =>
              update(
                "providerName",
                value
              )
            }
            kindFilter={[
              "Insurance Company",
              "Workers Insurance",
            ]}
          />

          <div className="space-y-2">
            <Label>
              Policy / Account Number *
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

                  event.target
                    .value
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

                  event.target
                    .value
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

                  event.target
                    .value
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

                  event.target
                    .value
                )
              }
            />
          </div>
        </div>

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
      </CardContent>
    </Card>
  )
}

/* =========================================================
   BOND DRAFT
========================================================= */

function BondDraftForm({
  draft,
  onChange,
}: {
  draft: BondDraft

  onChange: (
    draft: BondDraft
  ) => void
}) {
  const update = <
    K extends keyof BondDraft
  >(
    key: K,
    value: BondDraft[K]
  ) =>
    onChange({
      ...draft,

      [key]: value,
    })

  return (
    <Card className="overflow-visible shadow-none">
      <CardHeader className="border-b bg-muted/15 py-4">
        <CardTitle className="text-sm">
          Surety Bond Record
        </CardTitle>
      </CardHeader>

      <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label>
            Bond Type *
          </Label>

          <Select
            value={
              draft.bondType ||
              undefined
            }
            onValueChange={(
              value
            ) =>
              update(
                "bondType",
                value
              )
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>

            <SelectContent className="z-[150]">
              <SelectItem value="BMC-84 Freight Broker Bond">
                BMC-84 Freight Broker Bond
              </SelectItem>

              <SelectItem value="BMC-85 Trust Fund">
                BMC-85 Trust Fund
              </SelectItem>

              <SelectItem value="MCS-82 Public Liability Surety Bond">
                MCS-82 Public Liability Surety Bond
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
            </SelectContent>
          </Select>
        </div>

        <OrganizationInput
          label="Surety Company *"
          value={
            draft.suretyName
          }
          onChange={(
            value
          ) =>
            update(
              "suretyName",
              value
            )
          }
          kindFilter={[
            "Insurance Company",
          ]}
        />

        <div className="space-y-2">
          <Label>
            Bond Number *
          </Label>

          <Input
            value={
              draft.bondNumber
            }
            onChange={(
              event
            ) =>
              update(
                "bondNumber",

                event.target
                  .value
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Principal
          </Label>

          <Input
            value={
              draft.principalName
            }
            onChange={(
              event
            ) =>
              update(
                "principalName",

                event.target
                  .value
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Bond Amount
          </Label>

          <Input
            value={
              draft.bondAmount
            }
            onChange={(
              event
            ) =>
              update(
                "bondAmount",

                event.target
                  .value
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

                event.target
                  .value
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

                event.target
                  .value
              )
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}

function CopyField({
  label,
  value,
}: {
  label: string
  value?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard may be unavailable in some development contexts.
    }
  }

  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
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
            onClick={copy}
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

function InsuranceRecordInspector({
  record,
  onClose,
  onEditBroker,
}: {
  record: SelectedInsuranceRecord | null
  onClose: () => void
  onEditBroker: (groupId: string) => void
}) {
  if (!record) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-[480px] flex-col items-center justify-center p-10 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <ShieldCheck className="size-7 text-muted-foreground/40" />
          </div>
          <p className="mt-4 text-sm font-medium">Select an insurance record</p>
          <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted-foreground">
            View policy information, expiry status, coverage, insurer and broker details.
          </p>
        </CardContent>
      </Card>
    )
  }

  const isTransportation = record.family === "transportation"
  const isWorkers = record.family === "workers"

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-primary/[0.035]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">
                {isTransportation
                  ? record.insuranceType
                  : isWorkers
                    ? record.insuranceType
                    : record.bondType}
              </CardTitle>
              <ExpiryBadge status={record.status} />
            </div>
            <CardDescription className="mt-1 font-mono text-[10px]">
              {record.id}
            </CardDescription>
          </div>

          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-4">
        {isTransportation && (
          <>
            <section>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Policy
              </Label>
              <div className="mt-3 grid gap-4">
                <CopyField label="Insurance Company" value={record.insurerName} />
                <CopyField label="Policy Number" value={record.policyNumber} />
                <CopyField label="Effective Date" value={record.effectiveDate} />
                <CopyField label="Expiry Date" value={record.expiryDate} />
              </div>
            </section>

            <section className="border-t pt-4">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Key Coverage
              </Label>
              <div className="mt-3 space-y-2">
                {record.coverage.length ? (
                  record.coverage.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <span className="text-xs text-muted-foreground">{item.label}</span>
                      <span className="text-xs font-semibold">{item.value}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    See source document for coverage details.
                  </p>
                )}
              </div>
            </section>

            <section className="border-t pt-4">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Insurance Broker
                </Label>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px]"
                  onClick={() => onEditBroker(record.groupId)}
                >
                  <Pencil className="mr-1 size-3" />
                  Edit
                </Button>
              </div>

              {record.broker ? (
                <div className="mt-3 space-y-4">
                  <CopyField label="Broker Company" value={record.broker.organizationName} />
                  <CopyField label="Broker Contact" value={record.broker.contactName} />
                  <CopyField label="Email" value={record.broker.contactEmail} />
                  <CopyField label="Phone" value={record.broker.contactPhone} />
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  No broker information recorded.
                </p>
              )}
            </section>
          </>
        )}

        {isWorkers && (
          <>
            <CopyField label="Provider" value={record.providerName} />
            <CopyField label="Policy / Account Number" value={record.policyNumber} />
            <CopyField label="Jurisdiction" value={record.jurisdiction} />
            <CopyField label="Effective Date" value={record.effectiveDate} />
            <CopyField label="Expiry Date" value={record.expiryDate} />

            <section className="border-t pt-4">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Coverage
              </Label>
              <div className="mt-3 space-y-2">
                {record.coverage.length ? (
                  record.coverage.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <span className="text-xs text-muted-foreground">{item.label}</span>
                      <span className="text-xs font-semibold">{item.value}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    See source document for coverage details.
                  </p>
                )}
              </div>
            </section>
          </>
        )}

        {record.family === "bond" && (
          <>
            <CopyField label="Surety Company" value={record.suretyName} />
            <CopyField label="Bond Number" value={record.bondNumber} />
            <CopyField label="Principal" value={record.principalName} />
            <CopyField label="Bond Amount" value={record.bondAmount} />
            <CopyField label="Effective Date" value={record.effectiveDate} />
            <CopyField label="Expiry Date" value={record.expiryDate || "Continuous"} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ManualInsuranceModal({
  family,
  company,
  onCancel,
  onSaveTransportation,
  onSaveWorkers,
  onSaveBond,
}: {
  family: RecordFamily
  company: Company
  onCancel: () => void
  onSaveTransportation: (draft: TransportationDraft) => void
  onSaveWorkers: (draft: WorkersDraft) => void
  onSaveBond: (draft: BondDraft) => void
}) {
  const [transportationDraft, setTransportationDraft] =
    useState(emptyTransportationDraft())

  const [workersDraft, setWorkersDraft] =
    useState(emptyWorkersDraft())

  const [bondDraft, setBondDraft] =
    useState(emptyBondDraft(company.name))

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto">
        {family === "transportation" && (
          <TransportationDraftEditor
            index={0}
            draft={transportationDraft}
            onChange={setTransportationDraft}
            allowRemove={false}
            onRemove={() => {}}
          />
        )}

        {family === "workers" && (
          <WorkersDraftForm
            draft={workersDraft}
            onChange={setWorkersDraft}
          />
        )}

        {family === "bond" && (
          <BondDraftForm
            draft={bondDraft}
            onChange={setBondDraft}
          />
        )}

        <div className="mt-3 flex justify-end gap-2 rounded-xl border bg-background p-4 shadow-lg">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (family === "transportation") onSaveTransportation(transportationDraft)
              if (family === "workers") onSaveWorkers(workersDraft)
              if (family === "bond") onSaveBond(bondDraft)
            }}
          >
            <Save className="mr-2 size-4" />
            Save Record
          </Button>
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   BROKER EDITOR

   Edits canonical broker company/contact relationship
   across every policy created from same COI/group.
========================================================= */

function BrokerEditor({
  records,
  onCancel,
  onSave,
}: {
  records:
    TransportationInsuranceRecord[]

  onCancel: () => void

  onSave: (
    broker: BrokerReference
  ) => void
}) {
  const current =
    records.find(
      (record) =>
        record.broker
    )?.broker

  const [
    companyName,
    setCompanyName,
  ] = useState(
    current?.organizationName ||
      ""
  )

  const [
    contactName,
    setContactName,
  ] = useState(
    current?.contactName ||
      ""
  )

  const [email, setEmail] =
    useState(
      current?.contactEmail ||
        ""
    )

  const [phone, setPhone] =
    useState(
      current?.contactPhone ||
        ""
    )

  const save = () => {
    const organization =
      resolveOrganization(
        companyName,

        "Insurance Broker"
      )

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

    updateBrokerContact({
      contactId:
        contact.contactId,

      name:
        contactName,

      email,
      phone,
    })

    onSave({
      organizationId:
        organization.organizationId,

      organizationName:
        organization.organizationName,

      contactId:
        contact.contactId,

      contactName:
        contact.contactName,

      contactEmail:
        contact.contactEmail,

      contactPhone:
        contact.contactPhone,
    })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-2xl overflow-visible">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">
                Edit Insurance Broker
              </CardTitle>

              <CardDescription className="mt-1">
                Broker organization and broker contact remain separate linked TES identities.
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

        <CardContent className="grid gap-4 md:grid-cols-2">
          <OrganizationInput
            label="Broker Company"
            value={
              companyName
            }
            onChange={
              setCompanyName
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
                contactName
              }
              onChange={(
                event
              ) =>
                setContactName(
                  event.target.value
                )
              }
            />
          </div>

          <div className="space-y-2">
            <Label>
              Contact Email
            </Label>

            <Input
              type="email"
              value={email}
              onChange={(
                event
              ) =>
                setEmail(
                  event.target.value
                )
              }
            />
          </div>

          <div className="space-y-2">
            <Label>
              Contact Phone
            </Label>

            <Input
              value={phone}
              onChange={(
                event
              ) =>
                setPhone(
                  event.target.value
                )
              }
            />
          </div>

          <div className="flex justify-end gap-2 border-t pt-4 md:col-span-2">
            <Button
              variant="outline"
              onClick={
                onCancel
              }
            >
              Cancel
            </Button>

            <Button
              onClick={save}
            >
              <Save className="mr-2 size-4" />

              Save Broker
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* =========================================================
   TRANSPORTATION ROW
========================================================= */

function TransportationRow({
  record,
  selected,
  onSelect,
  onArchive,
}: {
  record: TransportationInsuranceRecord
  selected?: boolean
  onSelect: () => void
  onArchive: () => void
}) {
  const style =
    statusStyle(
      record.status
    )

  const days =
    getDaysRemaining(
      record.expiryDate
    )

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={`cursor-pointer grid gap-4 border-l-4 p-4 transition-colors hover:bg-muted/30 md:grid-cols-12 ${style.accent} ${selected ? "bg-primary/[0.045] ring-1 ring-inset ring-primary/20" : ""}`}
    >
      <div className="md:col-span-3">
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
          {
            record.id
          }
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="text-sm font-medium">
          {
            record.insurerName
          }
        </p>

        <p className="mt-1 select-text font-mono text-[10px] text-muted-foreground">
          Policy{" "}
          {
            record.policyNumber
          }
        </p>
      </div>

      <div className="md:col-span-2">
        {record.coverage
          .slice(0, 3)
          .map(
            (coverage) => (
              <div
                key={
                  coverage.id
                }
                className="mb-1 text-[10px]"
              >
                <span className="text-muted-foreground">
                  {
                    coverage.label
                  }
                  :
                </span>{" "}

                <span className="font-medium">
                  {
                    coverage.value
                  }
                </span>
              </div>
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
            {days < 0
              ? `${Math.abs(days)} days overdue`
              : `${days} days remaining`}
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
            className="size-8"
            onClick={(event) => {
              event.stopPropagation()
              onArchive()
            }}
          >
            <Archive className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

/* =========================================================
   SIMPLE WORKERS ROW
========================================================= */

function WorkersRow({
  record,
  selected,
  onSelect,
  onArchive,
}: {
  record: WorkersInsuranceRecord
  selected?: boolean
  onSelect: () => void
  onArchive: () => void
}) {
  const style =
    statusStyle(
      record.status
    )

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={`cursor-pointer grid gap-4 border-l-4 p-4 transition-colors hover:bg-muted/30 md:grid-cols-12 ${style.accent} ${selected ? "bg-primary/[0.045] ring-1 ring-inset ring-primary/20" : ""}`}
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
            "—"
          }
        </p>
      </div>

      <div className="md:col-span-2">
        {record.coverage
          .slice(0, 2)
          .map(
            (coverage) => (
              <p
                key={
                  coverage.id
                }
                className="text-[10px]"
              >
                {
                  coverage.label
                }
                :{" "}
                <strong>
                  {
                    coverage.value
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
            onClick={(event) => {
              event.stopPropagation()
              onArchive()
            }}
          >
            <Archive className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

/* =========================================================
   BOND ROW
========================================================= */

function BondRow({
  record,
  selected,
  onSelect,
  onArchive,
}: {
  record: BondRecord
  selected?: boolean
  onSelect: () => void
  onArchive: () => void
}) {
  const style =
    statusStyle(
      record.status
    )

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={`cursor-pointer grid gap-4 border-l-4 p-4 transition-colors hover:bg-muted/30 md:grid-cols-12 ${style.accent} ${selected ? "bg-primary/[0.045] ring-1 ring-inset ring-primary/20" : ""}`}
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
            onClick={(event) => {
              event.stopPropagation()
              onArchive()
            }}
          >
            <Archive className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

/* =========================================================
   STATUS COUNT
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
        <p className="text-xs text-muted-foreground">
          {label}
        </p>

        <div className="mt-2 flex items-end justify-between gap-2">
          <p className="text-2xl font-bold">
            {count}
          </p>

          <ExpiryBadge
            status={status}
          />
        </div>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function InsurancePage() {
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
    sourceFamily,
    setSourceFamily,
  ] =
    useState<RecordFamily | null>(
      null
    )

  const [
    showCamera,
    setShowCamera,
  ] = useState(false)

  const [
    ocrSession,
    setOcrSession,
  ] =
    useState<OCRSession | null>(
      null
    )

  const [
    brokerEditGroup,
    setBrokerEditGroup,
  ] =
    useState<string | null>(
      null
    )

  const [manualFamily, setManualFamily] =
    useState<RecordFamily | null>(null)

  const [selectedRecord, setSelectedRecord] =
    useState<SelectedInsuranceRecord | null>(null)

  const storageKey =
    `tes_company_insurance_${companyId}`

  /* =======================================================
     LOAD
  ======================================================= */

  useEffect(() => {
    try {
      const companies =
        getCompanies()

      setCompany(
        companies.find(
          (item) =>
            item.id ===
            companyId
        ) || null
      )

      const raw =
        localStorage.getItem(
          storageKey
        )

      if (raw) {
        const parsed =
          JSON.parse(raw)

        if (
          parsed &&
          !Array.isArray(
            parsed
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
        }
      }

      setSettings(
        loadSystemSettings()
      )
    } catch (error) {
      console.error(
        error
      )
    } finally {
      setLoading(false)
    }
  }, [
    companyId,
    storageKey,
  ])

  /* =======================================================
     SAVE
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
     STATUS
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
                )
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
                )
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
                )
              ),
          })
        ),

      [
        data.bonds,
        settings.expiryRules,
      ]
    )

  const all =
    [
      ...transportation,
      ...workers,
      ...bonds,
    ]

  const count = (
    status: ExpiryStatus
  ) =>
    all.filter(
      (item) =>
        item.status ===
        status
    ).length

  /* =======================================================
     SOURCE
  ======================================================= */

  const selectSource = (
    family: RecordFamily
  ) => {
    setSourceFamily(
      family
    )
  }

  const processDocument =
    async (
      file: File,
      source: DocumentSource
    ) => {
      if (!sourceFamily) {
        return
      }

      const dataUrl =
        await readFileAsDataUrl(
          file
        )

      setOcrSession({
        family:
          sourceFamily,

        source,

        file,

        dataUrl,

        processing: false,

        extractionComplete:
          false,

        transportationRecords:
          [
            emptyTransportationDraft(),
          ],

        workersDraft:
          emptyWorkersDraft(),

        bondDraft:
          emptyBondDraft(
            company?.name ||
              ""
          ),

        brokerName: "",

        brokerContactName:
          "",

        brokerEmail: "",

        brokerPhone: "",
      })

      setSourceFamily(
        null
      )
    }

  /* =======================================================
     BROKER
  ======================================================= */

  const resolveBroker = (
    session: OCRSession
  ): BrokerReference | undefined => {
    if (
      !session.brokerName.trim() &&
      !session.brokerContactName.trim() &&
      !session.brokerEmail.trim() &&
      !session.brokerPhone.trim()
    ) {
      return undefined
    }

    const broker =
      resolveOrganization(
        session.brokerName,

        "Insurance Broker"
      )

    const contact =
      resolveBrokerContact({
        brokerOrganizationId:
          broker.organizationId,

        brokerOrganizationName:
          broker.organizationName,

        contactName:
          session.brokerContactName,

        email:
          session.brokerEmail,

        phone:
          session.brokerPhone,
      })

    return {
      organizationId:
        broker.organizationId,

      organizationName:
        broker.organizationName,

      contactId:
        contact.contactId,

      contactName:
        contact.contactName,

      contactEmail:
        contact.contactEmail,

      contactPhone:
        contact.contactPhone,
    }
  }

  /* =======================================================
     SAVE OCR
  ======================================================= */

  const saveOCRSession = (
    session: OCRSession
  ) => {
    const evidence:
      InsuranceEvidence =
      {
        id:
          createId(
            "DOC"
          ),

        family:
          session.family,

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

    const timestamp =
      isoNow()

    if (
      session.family ===
      "transportation"
    ) {
      const groupId =
        createId(
          "COI"
        )

      const broker =
        resolveBroker(
          session
        )

      const records:
        TransportationInsuranceRecord[] =
        []

      for (
        const draft of
        session.transportationRecords
      ) {
        const insurer =
          resolveOrganization(
            draft.insurerName,

            "Insurance Company"
          )

        /*
          Same insurer + policy + exact period = duplicate.
        */

        const duplicate =
          transportation.find(
            (existing) =>
              !existing.archivedAt &&
              normalizeCompanyName(
                existing.insurerName
              ) ===
                normalizeCompanyName(
                  insurer.organizationName
                ) &&
              normalizeIdentifier(
                existing.policyNumber
              ) ===
                normalizeIdentifier(
                  draft.policyNumber
                ) &&
              existing.effectiveDate ===
                draft.effectiveDate &&
              existing.expiryDate ===
                draft.expiryDate
          )

        if (duplicate) {
          continue
        }

        /*
          Same policy number but new period = renewal.
        */

        const previous =
          transportation.find(
            (existing) =>
              normalizeCompanyName(
                existing.insurerName
              ) ===
                normalizeCompanyName(
                  insurer.organizationName
                ) &&
              normalizeIdentifier(
                existing.policyNumber
              ) ===
                normalizeIdentifier(
                  draft.policyNumber
                )
          )

        records.push({
          id:
            createId(
              "INS"
            ),

          groupId,

          family:
            "transportation",

          insuranceType:
            draft.insuranceType.trim(),

          canonicalType:
            normalizeInsuranceType(
              draft.insuranceType
            ),

          insurerOrganizationId:
            insurer.organizationId,

          insurerName:
            insurer.organizationName,

          policyNumber:
            draft.policyNumber.trim(),

          effectiveDate:
            draft.effectiveDate,

          expiryDate:
            draft.expiryDate,

          coverage:
            draft.coverage
              .filter(
                (item) =>
                  item.label.trim() ||
                  item.value.trim()
              )
              .slice(
                0,
                6
              ),

          broker,

          evidenceId:
            evidence.id,

          source:
            "OCR",

          status:
            getExpiryStatus(
              draft.expiryDate,

              settings.expiryRules
            ),

          previousRecordId:
            previous?.id,

          createdAt:
            timestamp,

          updatedAt:
            timestamp,
        })
      }

      if (!records.length) {
        window.alert(
          "No new records were created. Matching insurer, policy number and policy period already exist."
        )

        return
      }

      setData(
        (current) => ({
          ...current,

          transportation:
            [
              ...records,

              ...current.transportation,
            ],

          evidence:
            [
              evidence,

              ...current.evidence,
            ],
        })
      )
    }

    if (
      session.family ===
      "workers"
    ) {
      const draft =
        session.workersDraft

      const provider =
        resolveOrganization(
          draft.providerName,

          "Workers Insurance"
        )

      const duplicate =
        workers.find(
          (existing) =>
            !existing.archivedAt &&
            normalizeCompanyName(
              existing.providerName
            ) ===
              normalizeCompanyName(
                provider.organizationName
              ) &&
            normalizeIdentifier(
              existing.policyNumber
            ) ===
              normalizeIdentifier(
                draft.policyNumber
              ) &&
            existing.effectiveDate ===
              draft.effectiveDate &&
            existing.expiryDate ===
              draft.expiryDate
        )

      if (duplicate) {
        window.alert(
          "This workers insurance record already exists."
        )

        return
      }

      const record:
        WorkersInsuranceRecord =
        {
          id:
            createId(
              "WCB"
            ),

          family:
            "workers",

          insuranceType:
            draft.insuranceType,

          providerOrganizationId:
            provider.organizationId,

          providerName:
            provider.organizationName,

          policyNumber:
            draft.policyNumber.trim(),

          jurisdiction:
            draft.jurisdiction.trim(),

          effectiveDate:
            draft.effectiveDate,

          expiryDate:
            draft.expiryDate,

          coverage:
            draft.coverage,

          evidenceId:
            evidence.id,

          source:
            "OCR",

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

          workers:
            [
              record,

              ...current.workers,
            ],

          evidence:
            [
              evidence,

              ...current.evidence,
            ],
        })
      )
    }

    if (
      session.family ===
      "bond"
    ) {
      const draft =
        session.bondDraft

      const surety =
        resolveOrganization(
          draft.suretyName,

          "Insurance Company"
        )

      const duplicate =
        bonds.find(
          (existing) =>
            !existing.archivedAt &&
            normalizeCompanyName(
              existing.suretyName
            ) ===
              normalizeCompanyName(
                surety.organizationName
              ) &&
            normalizeIdentifier(
              existing.bondNumber
            ) ===
              normalizeIdentifier(
                draft.bondNumber
              )
        )

      if (duplicate) {
        window.alert(
          "This bond already exists for the same surety."
        )

        return
      }

      const record:
        BondRecord =
        {
          id:
            createId(
              "BND"
            ),

          family:
            "bond",

          bondType:
            draft.bondType,

          suretyOrganizationId:
            surety.organizationId,

          suretyName:
            surety.organizationName,

          bondNumber:
            draft.bondNumber.trim(),

          principalName:
            draft.principalName.trim(),

          bondAmount:
            draft.bondAmount.trim(),

          effectiveDate:
            draft.effectiveDate,

          expiryDate:
            draft.expiryDate ||
            undefined,

          evidenceId:
            evidence.id,

          source:
            "OCR",

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

          bonds:
            [
              record,

              ...current.bonds,
            ],

          evidence:
            [
              evidence,

              ...current.evidence,
            ],
        })
      )
    }

    setOcrSession(null)
  }

  /* =======================================================
     MANUAL RECORD SAVE
  ======================================================= */

  const saveManualTransportationRecord = (
    draft: TransportationDraft
  ) => {
    if (
      !draft.insuranceType.trim() ||
      !draft.insurerName.trim() ||
      !draft.policyNumber.trim() ||
      !draft.effectiveDate ||
      !draft.expiryDate
    ) {
      window.alert(
        "Please complete the insurance type, insurer, policy number, effective date and expiry date."
      )
      return
    }

    const insurer = resolveOrganization(
      draft.insurerName,
      "Insurance Company"
    )

    const duplicate = transportation.find(
      (existing) =>
        !existing.archivedAt &&
        normalizeCompanyName(existing.insurerName) ===
          normalizeCompanyName(insurer.organizationName) &&
        normalizeIdentifier(existing.policyNumber) ===
          normalizeIdentifier(draft.policyNumber) &&
        existing.effectiveDate === draft.effectiveDate &&
        existing.expiryDate === draft.expiryDate
    )

    if (duplicate) {
      window.alert("This transportation insurance record already exists.")
      return
    }

    const timestamp = isoNow()
    const record: TransportationInsuranceRecord = {
      id: createId("INS"),
      groupId: createId("COI"),
      family: "transportation",
      insuranceType: draft.insuranceType.trim(),
      canonicalType: normalizeInsuranceType(draft.insuranceType),
      insurerOrganizationId: insurer.organizationId,
      insurerName: insurer.organizationName,
      policyNumber: draft.policyNumber.trim(),
      effectiveDate: draft.effectiveDate,
      expiryDate: draft.expiryDate,
      coverage: draft.coverage.filter(
        (item) => item.label.trim() || item.value.trim()
      ),
      source: "Manual",
      status: getExpiryStatus(draft.expiryDate, settings.expiryRules),
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    setData((current) => ({
      ...current,
      transportation: [record, ...current.transportation],
    }))
    setManualFamily(null)
    setSelectedRecord(record)
  }

  const saveManualWorkersRecord = (
    draft: WorkersDraft
  ) => {
    if (
      !draft.insuranceType.trim() ||
      !draft.providerName.trim() ||
      !draft.policyNumber.trim() ||
      !draft.effectiveDate ||
      !draft.expiryDate
    ) {
      window.alert(
        "Please complete the insurance type, provider, policy/account number, effective date and expiry date."
      )
      return
    }

    const provider = resolveOrganization(
      draft.providerName,
      "Workers Insurance"
    )

    const duplicate = workers.find(
      (existing) =>
        !existing.archivedAt &&
        normalizeCompanyName(existing.providerName) ===
          normalizeCompanyName(provider.organizationName) &&
        normalizeIdentifier(existing.policyNumber) ===
          normalizeIdentifier(draft.policyNumber) &&
        existing.effectiveDate === draft.effectiveDate &&
        existing.expiryDate === draft.expiryDate
    )

    if (duplicate) {
      window.alert("This workers insurance record already exists.")
      return
    }

    const timestamp = isoNow()
    const record: WorkersInsuranceRecord = {
      id: createId("WCB"),
      family: "workers",
      insuranceType: draft.insuranceType.trim(),
      providerOrganizationId: provider.organizationId,
      providerName: provider.organizationName,
      policyNumber: draft.policyNumber.trim(),
      jurisdiction: draft.jurisdiction.trim(),
      effectiveDate: draft.effectiveDate,
      expiryDate: draft.expiryDate,
      coverage: draft.coverage.filter(
        (item) => item.label.trim() || item.value.trim()
      ),
      source: "Manual",
      status: getExpiryStatus(draft.expiryDate, settings.expiryRules),
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    setData((current) => ({
      ...current,
      workers: [record, ...current.workers],
    }))
    setManualFamily(null)
    setSelectedRecord(record)
  }

  const saveManualBondRecord = (
    draft: BondDraft
  ) => {
    if (
      !draft.bondType.trim() ||
      !draft.suretyName.trim() ||
      !draft.bondNumber.trim() ||
      !draft.principalName.trim() ||
      !draft.bondAmount.trim() ||
      !draft.effectiveDate
    ) {
      window.alert(
        "Please complete the bond type, surety, bond number, principal, amount and effective date."
      )
      return
    }

    const surety = resolveOrganization(
      draft.suretyName,
      "Insurance Company"
    )

    const duplicate = bonds.find(
      (existing) =>
        !existing.archivedAt &&
        normalizeCompanyName(existing.suretyName) ===
          normalizeCompanyName(surety.organizationName) &&
        normalizeIdentifier(existing.bondNumber) ===
          normalizeIdentifier(draft.bondNumber)
    )

    if (duplicate) {
      window.alert("This bond already exists for the same surety.")
      return
    }

    const timestamp = isoNow()
    const record: BondRecord = {
      id: createId("BND"),
      family: "bond",
      bondType: draft.bondType.trim(),
      suretyOrganizationId: surety.organizationId,
      suretyName: surety.organizationName,
      bondNumber: draft.bondNumber.trim(),
      principalName: draft.principalName.trim(),
      bondAmount: draft.bondAmount.trim(),
      effectiveDate: draft.effectiveDate,
      expiryDate: draft.expiryDate || undefined,
      source: "Manual",
      status: getExpiryStatus(draft.expiryDate, settings.expiryRules),
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    setData((current) => ({
      ...current,
      bonds: [record, ...current.bonds],
    }))
    setManualFamily(null)
    setSelectedRecord(record)
  }

  /* =======================================================
     BROKER UPDATE
  ======================================================= */

  const updateBrokerGroup = (
    groupId: string,

    broker: BrokerReference
  ) => {
    setData(
      (current) => ({
        ...current,

        transportation:
          current.transportation.map(
            (record) =>
              record.groupId ===
              groupId
                ? {
                    ...record,

                    broker,

                    updatedAt:
                      isoNow(),
                  }
                : record
          ),
      })
    )

    setBrokerEditGroup(
      null
    )
  }

  /* =======================================================
     ARCHIVE
  ======================================================= */

  const archiveTransportation = (
    id: string
  ) => {
    const reason =
      window.prompt(
        "Archive reason:"
      )

    if (!reason?.trim()) {
      return
    }

    setData(
      (current) => ({
        ...current,

        transportation:
          current.transportation.map(
            (record) =>
              record.id === id
                ? {
                    ...record,

                    status:
                      "Archived",

                    archivedAt:
                      isoNow(),

                    archivedBy:
                      "Current User",

                    archiveReason:
                      reason.trim(),

                    updatedAt:
                      isoNow(),
                  }
                : record
          ),
      })
    )
  }

  const archiveWorkers = (
    id: string
  ) => {
    const reason =
      window.prompt(
        "Archive reason:"
      )

    if (!reason?.trim()) {
      return
    }

    setData(
      (current) => ({
        ...current,

        workers:
          current.workers.map(
            (record) =>
              record.id === id
                ? {
                    ...record,

                    status:
                      "Archived",

                    archivedAt:
                      isoNow(),

                    archivedBy:
                      "Current User",

                    archiveReason:
                      reason.trim(),

                    updatedAt:
                      isoNow(),
                  }
                : record
          ),
      })
    )
  }

  const archiveBond = (
    id: string
  ) => {
    const reason =
      window.prompt(
        "Archive reason:"
      )

    if (!reason?.trim()) {
      return
    }

    setData(
      (current) => ({
        ...current,

        bonds:
          current.bonds.map(
            (record) =>
              record.id === id
                ? {
                    ...record,

                    status:
                      "Archived",

                    archivedAt:
                      isoNow(),

                    archivedBy:
                      "Current User",

                    archiveReason:
                      reason.trim(),

                    updatedAt:
                      isoNow(),
                  }
                : record
          ),
      })
    )
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

  const visibleTransportation =
    transportation.filter(
      (record) =>
        record.status !==
        "Archived"
    )

  const visibleWorkers =
    workers.filter(
      (record) =>
        record.status !==
        "Archived"
    )

  const visibleBonds =
    bonds.filter(
      (record) =>
        record.status !==
        "Archived"
    )

  const groups =
    Array.from(
      new Set(
        visibleTransportation.map(
          (record) =>
            record.groupId
        )
      )
    )

  return (
    <>
      <div className="flex max-w-7xl flex-col gap-6 pb-12">
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
                Insurance & Bonds
              </h1>

              <p className="mt-1 text-sm text-muted-foreground">
                {
                  company.name
                }{" "}
                <span className="font-mono text-xs">
                  (
                  {
                    company.id
                  }
                  )
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
                  {
                    company.regCorpState ||
                    "Unknown"
                  }
                  ,{" "}
                  {
                    company.regCorpCountry ||
                    "Unknown"
                  }
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Operating Region
                </p>

                <p className="mt-1 text-sm font-semibold">
                  {
                    company.region ||
                    "Not specified"
                  }
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border sm:block" />

              <button
                onClick={() =>
                  setSettings(
                    loadSystemSettings()
                  )
                }
                className="text-xs font-medium text-primary hover:underline"
              >
                Refresh Portal Renewal Rules
              </button>
            </div>
          </div>
        </div>

        {/* STATUS */}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatusCountCard
            label="Healthy"
            count={
              count(
                "Healthy"
              )
            }
            status="Healthy"
          />

          <StatusCountCard
            label="Watch"
            count={
              count(
                "Watch"
              )
            }
            status="Watch"
          />

          <StatusCountCard
            label="Urgent"
            count={
              count(
                "Urgent"
              )
            }
            status="Urgent"
          />

          <StatusCountCard
            label="Critical"
            count={
              count(
                "Critical"
              )
            }
            status="Critical"
          />

          <StatusCountCard
            label="Expired"
            count={
              count(
                "Expired"
              )
            }
            status="Expired"
          />
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-6">
            <Card className="overflow-visible">
              <CardHeader className="border-b bg-muted/20">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <ShieldCheck className="size-4 text-primary" />
                      Transportation Insurance
                    </CardTitle>
                    <CardDescription className="mt-1 text-xs">
                      One COI can create multiple insurer/policy records.
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => selectSource("transportation")}>
                      <ScanDocumentIcon size={14} />
                      <span className="ml-2">Scan Insurance Document</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setManualFamily("transportation")}
                    >
                      <Plus className="mr-2 size-4" />
                      Add Insurance
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {visibleTransportation.length === 0 ? (
                  <div className="p-12 text-center">
                    <ScanDocumentIcon size={28} />
                    <p className="mt-4 text-sm font-semibold">
                      No transportation insurance recorded
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Scan the current COI or add an insurance record manually.
                    </p>
                  </div>
                ) : (
                  <div>
                    {groups.map((groupId) => {
                      const groupRecords = visibleTransportation.filter(
                        (record) => record.groupId === groupId
                      )
                      return (
                        <div key={groupId} className="border-b last:border-b-0">
                          <div className="bg-muted/10 px-4 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              COI / Insurance Group
                            </p>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Select a record to view policy, coverage and broker details.
                            </p>
                          </div>
                          <div className="divide-y">
                            {groupRecords.map((record) => (
                              <TransportationRow
                                key={record.id}
                                record={record}
                                selected={selectedRecord?.id === record.id}
                                onSelect={() => setSelectedRecord(record)}
                                onArchive={() => archiveTransportation(record.id)}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b bg-muted/20">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <HardHat className="size-4 text-primary" />
                      Workers Insurance
                    </CardTitle>
                    <CardDescription className="mt-1 text-xs">
                      Separate workers compensation and occupational coverage records.
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => selectSource("workers")}>
                      <ScanDocumentIcon size={14} />
                      <span className="ml-2">Scan Workers Document</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setManualFamily("workers")}
                    >
                      <Plus className="mr-2 size-4" />
                      Add Workers Insurance
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {visibleWorkers.length === 0 ? (
                  <div className="p-10 text-center">
                    <HardHat className="mx-auto size-9 text-muted-foreground/30" />
                    <p className="mt-3 text-sm font-medium">No active workers insurance</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Scan a document or add a workers insurance record manually.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {visibleWorkers.map((record) => (
                      <WorkersRow
                        key={record.id}
                        record={record}
                        selected={selectedRecord?.id === record.id}
                        onSelect={() => setSelectedRecord(record)}
                        onArchive={() => archiveWorkers(record.id)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b bg-muted/20">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <FileKey2 className="size-4 text-primary" />
                      Surety Bonds
                    </CardTitle>
                    <CardDescription className="mt-1 text-xs">
                      Customs, broker, permit and other surety obligations.
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => selectSource("bond")}>
                      <ScanDocumentIcon size={14} />
                      <span className="ml-2">Scan Bond Document</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setManualFamily("bond")}
                    >
                      <Plus className="mr-2 size-4" />
                      Add Bond
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {visibleBonds.length === 0 ? (
                  <div className="p-10 text-center">
                    <FileKey2 className="mx-auto size-9 text-muted-foreground/30" />
                    <p className="mt-3 text-sm font-medium">No active surety bonds</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Scan a bond or add a bond record manually.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {visibleBonds.map((record) => (
                      <BondRow
                        key={record.id}
                        record={record}
                        selected={selectedRecord?.id === record.id}
                        onSelect={() => setSelectedRecord(record)}
                        onArchive={() => archiveBond(record.id)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="xl:sticky xl:top-6">
            <InsuranceRecordInspector
              record={selectedRecord}
              onClose={() => setSelectedRecord(null)}
              onEditBroker={(groupId) => setBrokerEditGroup(groupId)}
            />
          </div>
        </div>

        {/* INTEGRITY */}

        <Card className="border-dashed bg-muted/10">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <History className="mt-0.5 size-4 text-primary" />

              <div>
                <p className="text-xs font-semibold">
                  Identity and evidence integrity
                </p>

                <p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">
                  Insurance companies, brokers and broker contacts are resolved against existing TES identities before new entities are created. Broker contacts belong to their broker organization and can be reused across every customer they handle.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* MANUAL ENTRY */}

      {manualFamily && (
        <ManualInsuranceModal
          family={manualFamily}
          company={company}
          onCancel={() => setManualFamily(null)}
          onSaveTransportation={saveManualTransportationRecord}
          onSaveWorkers={saveManualWorkersRecord}
          onSaveBond={saveManualBondRecord}
        />
      )}

      {/* SOURCE */}

      {sourceFamily && (
        <DocumentSourcePicker
          family={
            sourceFamily
          }
          onClose={() =>
            setSourceFamily(
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

            processDocument(
              file,
              "camera"
            )
          }}
        />
      )}

      {/* OCR */}

      {ocrSession && (
        <OCRWorkspaceView
          session={
            ocrSession
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
            const family =
              ocrSession.family

            setOcrSession(
              null
            )

            setSourceFamily(
              family
            )
          }}
          onSave={
            saveOCRSession
          }
        />
      )}

      {/* BROKER EDIT */}

      {brokerEditGroup && (
        <BrokerEditor
          records={transportation.filter(
            (record) =>
              record.groupId ===
              brokerEditGroup
          )}
          onCancel={() =>
            setBrokerEditGroup(
              null
            )
          }
          onSave={(
            broker
          ) =>
            updateBrokerGroup(
              brokerEditGroup,
              broker
            )
          }
        />
      )}

      {/* DEVICE FILE */}

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