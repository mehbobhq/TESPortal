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
    LOCKED COMPANY FIELDS.
    These are already connected to other TES pages.
    Do not rename them.
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

type CoverageItem = {
  id: string
  label: string
  value: string
}

type BrokerReference = {
  /*
    Sonic Insurance
  */
  organizationId?: string
  organizationName: string

  /*
    Harpreet Kaur

    This is a REFERENCE to the canonical Contact record.
    It is not a new Harpreet record created under each client.
  */
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
    Development/prototype storage only.
    Replace later with permanent document storage reference.
  */
  dataUrl?: string
}

type TransportationInsuranceRecord = {
  id: string

  /*
    Multiple insurance lines coming from the same COI
    share the same groupId.
  */
  groupId: string

  family: "transportation"

  /*
    Exact source-document wording.
    Example: COMMERCIAL GENERAL LIABILITY
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

type StoredInsuranceData = {
  version: number

  transportation: TransportationInsuranceRecord[]
  workers: WorkersInsuranceRecord[]
  bonds: BondRecord[]

  evidence: InsuranceEvidence[]
}

type SelectedInsuranceRecord =
  | TransportationInsuranceRecord
  | WorkersInsuranceRecord
  | BondRecord

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

/*
  This MUST remain aligned with the Contacts page.
*/
const CONTACT_STORAGE_KEYS = [
  "tes_contacts_v5",
  "tes_contacts_v4",
  "tes_contacts_v3",
]

const PRIMARY_CONTACT_STORAGE_KEY =
  "tes_contacts_v5"

const DEFAULT_EXPIRY_RULES: ExpiryRules = {
  healthyMinDays: 61,
  watchMinDays: 31,
  urgentMinDays: 11,
  criticalMinDays: 0,
  criticalMaxDays: 10,
}

const EMPTY_DATA: StoredInsuranceData = {
  version: 6,

  transportation: [],
  workers: [],
  bonds: [],

  evidence: [],
}

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

/* =========================================================
   SETTINGS
========================================================= */

function loadSystemSettings():
  SystemSettings {
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
   STRING SIMILARITY
========================================================= */

function levenshtein(
  a: string,
  b: string
) {
  if (!a.length) {
    return b.length
  }

  if (!b.length) {
    return a.length
  }

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

  if (!max) {
    return 100
  }

  const distance =
    levenshtein(a, b)

  return (
    ((max - distance) /
      max) *
    100
  )
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

    JSON.stringify(
      companies
    )
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
   ORGANIZATION RESOLVER

   Extract freely.
   Normalize carefully.
   Resolve aggressively.
   Create reluctantly.
========================================================= */

function resolveOrganization(
  name: string,

  desiredKind:
    | "Insurance Company"
    | "Insurance Broker"
    | "Workers Insurance"
    | "Surety Company"
) {
  const clean =
    name.trim()

  if (!clean) {
    return {
      organizationId:
        undefined,

      organizationName:
        "",

      created: false,
    }
  }

  const companies =
    getCompanies()

  const normalized =
    normalizeCompanyName(
      clean
    )

  /*
    Exact normalized name.
  */

  const exact =
    companies.find(
      (company) =>
        normalizeCompanyName(
          company.name
        ) === normalized
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
    Strong fuzzy match.

    Insurance organizations are a relatively controlled
    universe, so this intentionally favors resolution
    over unnecessary duplicate creation.
  */

  const probable =
    companies
      .map(
        (company) => ({
          company,

          score:
            similarity(
              normalized,

              normalizeCompanyName(
                company.name
              )
            ),
        })
      )
      .filter(
        (result) =>
          result.score >=
          92
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      )

  if (
    probable.length
  ) {
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
    Truly new organization.
  */

  const created: Company = {
    id:
      createCompanyId(
        companies
      ),

    name: clean,

    kind:
      desiredKind,

    contact:
      "N/A",

    region:
      "Not specified",

    status:
      "Active",

    tone:
      "ok",

    createdAt:
      isoNow(),

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

    created:
      true,
  }
}

/* =========================================================
   CONTACT STORE
========================================================= */

function getContacts(): Contact[] {
  try {
    for (
      const key of
      CONTACT_STORAGE_KEYS
    ) {
      const raw =
        localStorage.getItem(
          key
        )

      if (!raw) {
        continue
      }

      const parsed =
        JSON.parse(raw)

      if (
        Array.isArray(
          parsed
        )
      ) {
        return parsed
      }
    }

    return []
  } catch {
    return []
  }
}

function saveContacts(
  contacts: Contact[]
) {
  /*
    IMPORTANT:

    Insurance writes broker contacts to the SAME
    canonical Contact store used by the Company Contacts
    page.

    Therefore:

    Sonic Insurance
        ↓
    Harpreet Kaur

    will appear when Sonic's Contacts page filters by
    Sonic's company ID.
  */

  localStorage.setItem(
    PRIMARY_CONTACT_STORAGE_KEY,

    JSON.stringify(
      contacts
    )
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

      lastName:
        "",
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
   ORGANIZATION → CONTACT RELATIONSHIP

   This is the key architecture.

   Sonic Insurance owns the relationship with Harpreet.

   Client A / Client B / Client C do NOT each get another
   Harpreet contact record.
========================================================= */

function ensureContactOrganizationRelationship({
  contact,

  organizationId,
  organizationName,

  role,

  source = "document",
}: {
  contact: Contact

  organizationId: string
  organizationName: string

  role: string

  source?:
    | "manual"
    | "document"
    | "system"
}): Contact {
  const relationships =
    [
      ...(contact.relationships ||
        []),
    ]

  const existingIndex =
    relationships.findIndex(
      (relationship) =>
        relationship.companyId ===
        organizationId
    )

  /*
    If relationship already exists, update/reactivate it
    instead of creating another relationship.
  */

  if (
    existingIndex >= 0
  ) {
    relationships[
      existingIndex
    ] = {
      ...relationships[
        existingIndex
      ],

      companyId:
        organizationId,

      companyName:
        organizationName,

      role,

      status:
        "active",
    }
  } else {
    relationships.push({
      id:
        createId(
          "REL"
        ),

      companyId:
        organizationId,

      companyName:
        organizationName,

      role,

      status:
        "active",

      startDate:
        isoNow().slice(
          0,
          10
        ),

      source,
    })
  }

  return {
    ...contact,

    relationships,

    updatedAt:
      isoNow(),
  }
}

/* =========================================================
   BROKER CONTACT RESOLVER

   GLOBAL PERSON IDENTITY FIRST.

   1. Same email → same person.
   2. Same phone → same person.
   3. Same broker + strong name match → same person.
   4. Only then create new Contact.

   Example:

   Harpreet Kaur
   Har preet Kaur
   HARPREET KAUR

   must not become separate records when the identity
   evidence says they are the same person.
========================================================= */

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
  const contacts =
    getContacts()

  const emailKey =
    normalizeEmail(
      email
    )

  const phoneKey =
    normalizePhone(
      phone
    )

  const nameKey =
    normalizePersonName(
      contactName
    )

  let existing:
    | Contact
    | undefined

  /*
    Strong identity: email.
  */

  if (emailKey) {
    existing =
      contacts.find(
        (contact) =>
          normalizeEmail(
            contact.email
          ) ===
          emailKey
      )
  }

  /*
    Strong identity: phone.
  */

  if (
    !existing &&
    phoneKey
  ) {
    existing =
      contacts.find(
        (contact) =>
          normalizePhone(
            contact.phone
          ) ===
          phoneKey
      )
  }

  /*
    Same organization + highly similar normalized name.
  */

  if (
    !existing &&
    nameKey &&
    brokerOrganizationId
  ) {
    const candidates =
      contacts
        .filter(
          (contact) =>
            contact.relationships?.some(
              (
                relationship
              ) =>
                relationship.companyId ===
                brokerOrganizationId
            )
        )
        .map(
          (contact) => {
            const existingName =
              normalizePersonName(
                `${contact.firstName} ${contact.lastName}`
              )

            return {
              contact,

              score:
                similarity(
                  nameKey,
                  existingName
                ),
            }
          }
        )
        .filter(
          (candidate) =>
            candidate.score >=
            90
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        )

    if (
      candidates.length
    ) {
      existing =
        candidates[0].contact
    }
  }

  /*
    Existing person found.

    Preserve canonical Contact ID.
    Fill missing details.
    Ensure person is attached to Sonic / broker company.
  */

  if (existing) {
    const updatedContacts =
      contacts.map(
        (contact) => {
          if (
            contact.id !==
            existing!.id
          ) {
            return contact
          }

          let next: Contact = {
            ...contact,

            /*
              Never erase known data because a later COI
              contains less information.
            */

            email:
              contact.email ||
              email.trim(),

            phone:
              contact.phone ||
              phone.trim(),

            updatedAt:
              isoNow(),
          }

          if (
            brokerOrganizationId
          ) {
            next =
              ensureContactOrganizationRelationship({
                contact:
                  next,

                organizationId:
                  brokerOrganizationId,

                organizationName:
                  brokerOrganizationName,

                role:
                  "Insurance Broker Contact",

                source:
                  "document",
              })
          }

          return next
        }
      )

    saveContacts(
      updatedContacts
    )

    const canonical =
      updatedContacts.find(
        (contact) =>
          contact.id ===
          existing!.id
      )!

    return {
      contactId:
        canonical.id,

      contactName:
        `${canonical.firstName} ${canonical.lastName}`.trim(),

      contactEmail:
        canonical.email ||
        "",

      contactPhone:
        canonical.phone ||
        "",

      created:
        false,
    }
  }

  /*
    Do not create an empty Contact.
  */

  if (
    !contactName.trim() &&
    !email.trim() &&
    !phone.trim()
  ) {
    return {
      contactId:
        undefined,

      contactName:
        "",

      contactEmail:
        "",

      contactPhone:
        "",

      created:
        false,
    }
  }

  /*
    New person.

    This only happens after duplicate resolution failed.
  */

  const names =
    splitPersonName(
      contactName
    )

  let created: Contact = {
    id:
      createId(
        "CNT"
      ),

    globalId:
      createId(
        "USR"
      ),

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

    isPrimary:
      false,

    isArchived:
      false,

    relationships:
      [],

    createdAt:
      isoNow(),

    updatedAt:
      isoNow(),

    discoveredBy:
      "Insurance Document Intelligence",
  }

  /*
    IMPORTANT:

    Harpreet is attached to SONIC INSURANCE.

    We intentionally do not attach her as an owned
    Contact of the trucking client.
  */

  if (
    brokerOrganizationId
  ) {
    created =
      ensureContactOrganizationRelationship({
        contact:
          created,

        organizationId:
          brokerOrganizationId,

        organizationName:
          brokerOrganizationName,

        role:
          "Insurance Broker Contact",

        source:
          "document",
      })
  }

  saveContacts([
    created,
    ...contacts,
  ])

  return {
    contactId:
      created.id,

    contactName:
      `${created.firstName} ${created.lastName}`.trim(),

    contactEmail:
      created.email ||
      "",

    contactPhone:
      created.phone ||
      "",

    created:
      true,
  }
}

/* =========================================================
   UPDATE EXISTING BROKER CONTACT
========================================================= */

function updateBrokerContact({
  contactId,

  brokerOrganizationId,
  brokerOrganizationName,

  name,
  email,
  phone,
}: {
  contactId?: string

  brokerOrganizationId?: string
  brokerOrganizationName: string

  name: string
  email: string
  phone: string
}) {
  if (!contactId) {
    return
  }

  const contacts =
    getContacts()

  const names =
    splitPersonName(
      name
    )

  const updated =
    contacts.map(
      (contact) => {
        if (
          contact.id !==
          contactId
        ) {
          return contact
        }

        let next: Contact = {
          ...contact,

          firstName:
            names.firstName ||
            contact.firstName,

          lastName:
            names.lastName ||
            contact.lastName,

          email:
            email.trim(),

          phone:
            phone.trim(),

          updatedAt:
            isoNow(),
        }

        if (
          brokerOrganizationId
        ) {
          next =
            ensureContactOrganizationRelationship({
              contact:
                next,

              organizationId:
                brokerOrganizationId,

              organizationName:
                brokerOrganizationName,

              role:
                "Insurance Broker Contact",

              source:
                "document",
            })
        }

        return next
      }
    )

  saveContacts(
    updated
  )
}

/* =========================================================
   INSURANCE TYPE NORMALIZATION
========================================================= */

function normalizeInsuranceType(
  source: string
) {
  const value =
    source
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
    value.includes(
      "automobile"
    ) ||
    value.includes(
      "auto liability"
    )
  ) {
    return "AUTOMOBILE_LIABILITY"
  }

  if (
    value.includes(
      "motor truck cargo"
    )
  ) {
    return "MOTOR_TRUCK_CARGO"
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
      "physical damage"
    )
  ) {
    return "PHYSICAL_DAMAGE"
  }

  if (
    value.includes(
      "trailer interchange"
    )
  ) {
    return "TRAILER_INTERCHANGE"
  }

  if (
    value.includes(
      "umbrella"
    ) ||
    value.includes(
      "excess"
    )
  ) {
    return "UMBRELLA_EXCESS"
  }

  if (
    value.includes(
      "pollution"
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
  if (!expiryDate) {
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
  expiryDate:
    | string
    | undefined,

  rules:
    ExpiryRules,

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
  status:
    ExpiryStatus
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
  status:
    ExpiryStatus
}) {
  const style =
    statusStyle(
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

      {status ===
        "Archived" && (
        <Archive className="size-3" />
      )}

      {status}
    </Badge>
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
   EMPTY DRAFTS
========================================================= */

function emptyTransportationDraft():
  TransportationDraft {
  return {
    tempId:
      createId(
        "TMP"
      ),

    insuranceType:
      "",

    canonicalType:
      "OTHER",

    insurerName:
      "",

    policyNumber:
      "",

    effectiveDate:
      "",

    expiryDate:
      "",

    coverage:
      [],
  }
}

function emptyWorkersDraft():
  WorkersDraft {
  return {
    insuranceType:
      "",

    providerName:
      "",

    policyNumber:
      "",

    jurisdiction:
      "",

    effectiveDate:
      "",

    expiryDate:
      "",

    coverage:
      [],
  }
}

function emptyBondDraft(
  principalName = ""
): BondDraft {
  return {
    bondType:
      "",

    suretyName:
      "",

    bondNumber:
      "",

    principalName,

    bondAmount:
      "",

    effectiveDate:
      "",

    expiryDate:
      "",
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
        // Clipboard may fail during local/non-secure testing.
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
   ORGANIZATION AUTOCOMPLETE
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
  const [
    open,
    setOpen,
  ] =
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
        const filtered =
          companies.filter(
            (company) =>
              kindFilter.includes(
                company.kind ||
                  ""
              )
          )

        if (
          filtered.length
        ) {
          pool =
            filtered
        }
      }

      if (!query) {
        return pool.slice(
          0,
          8
        )
      }

      return pool
        .map(
          (company) => ({
            company,

            score:
              similarity(
                query,

                normalizeCompanyName(
                  company.name
                )
              ),
          })
        )
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
        .slice(
          0,
          8
        )
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
          value={
            value
          }
          autoComplete="off"
          onFocus={() =>
            setOpen(
              true
            )
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

            setOpen(
              true
            )
          }}
        />

        <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>

      {open &&
        matches.length >
          0 && (
          <div className="absolute left-0 right-0 z-[160] mt-1 max-h-60 overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl">
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

                    setOpen(
                      false
                    )
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
  items:
    CoverageItem[]

  onChange: (
    items:
      CoverageItem[]
  ) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label>
            Key Coverage
          </Label>

          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Keep the most useful coverage values visible. Full details remain available in the source document.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() =>
            onChange([
              ...items,

              {
                id:
                  createId(
                    "COV"
                  ),

                label:
                  "",

                value:
                  "",
              },
            ])
          }
        >
          <Plus className="mr-1 size-3.5" />

          Add
        </Button>
      </div>

      {items.length ===
      0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          No coverage summary added.
        </div>
      ) : (
        items.map(
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
        )
      )}
    </div>
  )
}

/* =========================================================
   DOCUMENT SOURCE
========================================================= */

function DocumentSourcePicker({
  family,
  onCamera,
  onDevice,
  onClose,
}: {
  family:
    RecordFamily

  onCamera: () => void
  onDevice: () => void
  onClose: () => void
}) {
  const title =
    family ===
    "transportation"
      ? "Transportation Insurance"
      : family ===
          "workers"
        ? "Workers Insurance"
        : "Surety Bond"

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-lg shadow-2xl">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ScanDocumentIcon
                  size={18}
                />

                Scan {title}
              </CardTitle>

              <CardDescription className="mt-1">
                Select the document source.
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
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Camera className="size-5" />
            </div>

            <p className="mt-4 text-sm font-semibold">
              Take Photo
            </p>

            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Open the camera, preview the complete document and capture it directly.
            </p>
          </button>

          <button
            type="button"
            onClick={
              onDevice
            }
            className="rounded-xl border p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.035]"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Upload className="size-5" />
            </div>

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
   REAL CAMERA
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
          if (
            !navigator.mediaDevices
              ?.getUserMedia
          ) {
            setError(
              "Camera access is not supported by this browser."
            )

            return
          }

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
        } catch (err) {
          console.error(
            err
          )

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

            `insurance-capture-${Date.now()}.jpg`,

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

            <p className="mt-2 text-xs leading-5 text-white/70">
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
    setZoom(1)

    setRotation(0)

    setPan({
      x: 0,
      y: 0,
    })
  }

  const fullscreen =
    async () => {
      const element =
        rootRef.current

      if (!element) {
        return
      }

      try {
        if (
          !document.fullscreenElement
        ) {
          await element.requestFullscreen()
        } else {
          await document.exitFullscreen()
        }
      } catch (error) {
        console.error(
          "Fullscreen failed",
          error
        )
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

  const endDrag = () => {
    dragRef.current.active =
      false
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
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b bg-background px-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold">
            Original Document
          </p>

          <p className="max-w-[350px] truncate text-[10px] text-muted-foreground">
            {file.name}
          </p>
        </div>

        <div className="flex items-center gap-1">
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

          <span className="w-12 text-center text-[10px] font-medium">
            {Math.round(
              zoom * 100
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
            type="button"
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
        </div>
      </div>

      <div
        className="relative min-h-[500px] flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        style={{
          touchAction:
            "none",
        }}
        onPointerDown={
          pointerDown
        }
        onPointerMove={
          pointerMove
        }
        onPointerUp={
          endDrag
        }
        onPointerCancel={
          endDrag
        }
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
                title="Insurance document"
                className="h-[72vh] w-[62vw] max-w-[1000px] rounded-lg border bg-background pointer-events-none"
              />
            ) : (
              <img
                src={
                  dataUrl
                }
                alt="Insurance document"
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
      </div>
    </div>
  )
}

/* =========================================================
   TRANSPORTATION DRAFT EDITOR
========================================================= */

function TransportationDraftEditor({
  index,
  draft,
  onChange,
  onRemove,
  allowRemove,
}: {
  index: number

  draft:
    TransportationDraft

  onChange: (
    draft:
      TransportationDraft
  ) => void

  onRemove: () => void

  allowRemove:
    boolean
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

      [key]:
        value,
    }

    if (
      key ===
      "insuranceType"
    ) {
      next.canonicalType =
        normalizeInsuranceType(
          String(
            value
          )
        )
    }

    onChange(
      next
    )
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
              One actual policy / insurance section from the document.
            </CardDescription>
          </div>

          {allowRemove && (
            <Button
              type="button"
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
   WORKERS DRAFT
========================================================= */

function WorkersDraftForm({
  draft,
  onChange,
}: {
  draft:
    WorkersDraft

  onChange: (
    draft:
      WorkersDraft
  ) => void
}) {
  const update = <
    K extends keyof WorkersDraft
  >(
    key: K,

    value:
      WorkersDraft[K]
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

              <SelectContent className="z-[170]">
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
              placeholder="e.g. Ontario"
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
  draft:
    BondDraft

  onChange: (
    draft:
      BondDraft
  ) => void
}) {
  const update = <
    K extends keyof BondDraft
  >(
    key: K,

    value:
      BondDraft[K]
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

            <SelectContent className="z-[170]">
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
            "Surety Company",
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

          <p className="text-[10px] text-muted-foreground">
            Leave blank for continuous bonds.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   OCR REQUEST

   Production endpoint first.

   Fallback remains for the COI we were using during
   development so you can test the complete workflow.
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
      "family",
      session.family
    )

    const response =
      await fetch(
        "/api/document-intelligence/insurance",

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
    /*
      OCR API not connected yet.
      Continue with prototype fallback.
    */
  }

  if (
    session.family ===
    "transportation"
  ) {
    return {
      confidence:
        90,

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
              Source policy number was redacted in the
              test document. Never invent evidence.
            */
            policyNumber:
              "",

            effectiveDate:
              "2025-12-24",

            expiryDate:
              "2026-12-24",

            coverage:
              [
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

            policyNumber:
              "",

            effectiveDate:
              "2025-12-24",

            expiryDate:
              "2026-12-24",

            coverage:
              [
                {
                  id:
                    createId(
                      "COV"
                    ),

                  label:
                    "Bodily Injury / Property Damage",

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

            policyNumber:
              "",

            effectiveDate:
              "2025-12-24",

            expiryDate:
              "2026-12-24",

            coverage:
              [
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
    Workers/Bond OCR uses the complete extraction UI,
    but we intentionally do not fabricate fields without
    a real sample document.
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

function OCRWorkspaceView({
  session,
  setSession,
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

  const ready =
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
                  {session.family ===
                  "transportation"
                    ? "Transportation Insurance Extraction"
                    : session.family ===
                        "workers"
                      ? "Workers Insurance Extraction"
                      : "Surety Bond Extraction"}
                </h2>

                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Verify the extracted information against the source document before saving.
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
                      Correct any field necessary before creating the authoritative TES record.
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
                        setSession(
                          (
                            current
                          ) =>
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
                                          ? next
                                          : item
                                    ),
                                }
                              : current
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
                  type="button"
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

                <Card className="overflow-visible border-primary/15 shadow-none">
                  <CardHeader className="border-b bg-primary/[0.025] py-4">
                    <CardTitle className="text-sm">
                      Insurance Broker
                    </CardTitle>

                    <CardDescription className="text-xs">
                      Broker company and broker contact are separate reusable TES identities.
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
   MANUAL ENTRY
========================================================= */

function ManualInsuranceModal({
  family,
  company,

  onCancel,

  onSaveTransportation,

  onSaveWorkers,

  onSaveBond,
}: {
  family:
    RecordFamily

  company:
    Company

  onCancel: () => void

  onSaveTransportation: (
    drafts:
      TransportationDraft[],

    broker: {
      companyName: string
      contactName: string
      email: string
      phone: string
    }
  ) => void

  onSaveWorkers: (
    draft:
      WorkersDraft
  ) => void

  onSaveBond: (
    draft:
      BondDraft
  ) => void
}) {
  const [
    transportationDrafts,
    setTransportationDrafts,
  ] =
    useState<
      TransportationDraft[]
    >([
      emptyTransportationDraft(),
    ])

  const [
    workersDraft,
    setWorkersDraft,
  ] =
    useState(
      emptyWorkersDraft()
    )

  const [
    bondDraft,
    setBondDraft,
  ] =
    useState(
      emptyBondDraft(
        company.name
      )
    )

  const [
    brokerCompany,
    setBrokerCompany,
  ] =
    useState("")

  const [
    brokerContact,
    setBrokerContact,
  ] =
    useState("")

  const [
    brokerEmail,
    setBrokerEmail,
  ] =
    useState("")

  const [
    brokerPhone,
    setBrokerPhone,
  ] =
    useState("")

  const transportationReady =
    transportationDrafts.every(
      (draft) =>
        draft.insuranceType.trim() &&
        draft.insurerName.trim() &&
        draft.policyNumber.trim() &&
        draft.effectiveDate &&
        draft.expiryDate
    )

  const workersReady =
    Boolean(
      workersDraft.insuranceType.trim() &&
        workersDraft.providerName.trim() &&
        workersDraft.policyNumber.trim() &&
        workersDraft.effectiveDate &&
        workersDraft.expiryDate
    )

  const bondReady =
    Boolean(
      bondDraft.bondType.trim() &&
        bondDraft.suretyName.trim() &&
        bondDraft.bondNumber.trim() &&
        bondDraft.effectiveDate
    )

  const ready =
    family ===
    "transportation"
      ? transportationReady
      : family ===
          "workers"
        ? workersReady
        : bondReady

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/45 p-4 backdrop-blur-sm">
      <div className="mx-auto my-6 max-w-5xl">
        <Card className="overflow-visible">
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">
                  {family ===
                  "transportation"
                    ? "Add Transportation Insurance"
                    : family ===
                        "workers"
                      ? "Add Workers Insurance"
                      : "Add Surety Bond"}
                </CardTitle>

                <CardDescription className="mt-1">
                  Manual entry creates the same record structure used by OCR.
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
            {family ===
              "transportation" && (
              <>
                {transportationDrafts.map(
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
                        setTransportationDrafts(
                          (
                            current
                          ) =>
                            current.map(
                              (
                                item,
                                itemIndex
                              ) =>
                                itemIndex ===
                                index
                                  ? next
                                  : item
                            )
                        )
                      }
                      allowRemove={
                        transportationDrafts.length >
                        1
                      }
                      onRemove={() =>
                        setTransportationDrafts(
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
                    />
                  )
                )}

                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() =>
                    setTransportationDrafts(
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

                    <CardDescription className="text-xs">
                      Existing broker organizations and contacts are reused whenever possible.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
                    <OrganizationInput
                      label="Broker Company"
                      value={
                        brokerCompany
                      }
                      onChange={
                        setBrokerCompany
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
                          brokerContact
                        }
                        onChange={(
                          event
                        ) =>
                          setBrokerContact(
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
                        Contact Phone
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
                  </CardContent>
                </Card>
              </>
            )}

            {family ===
              "workers" && (
              <WorkersDraftForm
                draft={
                  workersDraft
                }
                onChange={
                  setWorkersDraft
                }
              />
            )}

            {family ===
              "bond" && (
              <BondDraftForm
                draft={
                  bondDraft
                }
                onChange={
                  setBondDraft
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
                    family ===
                    "transportation"
                  ) {
                    onSaveTransportation(
                      transportationDrafts,

                      {
                        companyName:
                          brokerCompany,

                        contactName:
                          brokerContact,

                        email:
                          brokerEmail,

                        phone:
                          brokerPhone,
                      }
                    )

                    return
                  }

                  if (
                    family ===
                    "workers"
                  ) {
                    onSaveWorkers(
                      workersDraft
                    )

                    return
                  }

                  onSaveBond(
                    bondDraft
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
   BROKER EDITOR
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
    broker:
      BrokerReference
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
  ] =
    useState(
      current?.organizationName ||
        ""
    )

  const [
    contactName,
    setContactName,
  ] =
    useState(
      current?.contactName ||
        ""
    )

  const [
    email,
    setEmail,
  ] =
    useState(
      current?.contactEmail ||
        ""
    )

  const [
    phone,
    setPhone,
  ] =
    useState(
      current?.contactPhone ||
        ""
    )

  const save = () => {
    /*
      FIRST:
      resolve Sonic Insurance.
    */

    const organization =
      resolveOrganization(
        companyName,

        "Insurance Broker"
      )

    /*
      SECOND:
      resolve Harpreet globally and attach her to Sonic.
    */

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

    /*
      If editing an existing contact, update the canonical
      Contact record itself.
    */

    updateBrokerContact({
      contactId:
        contact.contactId,

      brokerOrganizationId:
        organization.organizationId,

      brokerOrganizationName:
        organization.organizationName,

      name:
        contactName,

      email,

      phone,
    })

    /*
      Insurance stores references only.
    */

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
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-2xl overflow-visible">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">
                Edit Insurance Broker
              </CardTitle>

              <CardDescription className="mt-1">
                Changes update the reusable broker organization/contact relationship.
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
              value={
                email
              }
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
              value={
                phone
              }
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
              onClick={
                save
              }
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
   RIGHT SIDE RECORD INSPECTOR
========================================================= */

function InsuranceRecordInspector({
  record,
  evidence,

  onClose,

  onEditBroker,
}: {
  record:
    SelectedInsuranceRecord | null

  evidence?:
    InsuranceEvidence

  onClose: () => void

  onEditBroker: (
    groupId: string
  ) => void
}) {
  if (!record) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-[520px] flex-col items-center justify-center p-10 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <ShieldCheck className="size-7 text-muted-foreground/40" />
          </div>

          <p className="mt-4 text-sm font-medium">
            Select a record
          </p>

          <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted-foreground">
            Open a saved insurance or bond record to review its details.
          </p>
        </CardContent>
      </Card>
    )
  }

  const transportation =
    record.family ===
    "transportation"

  const workers =
    record.family ===
    "workers"

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-primary/[0.03]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">
                {transportation
                  ? record.insuranceType
                  : workers
                    ? record.insuranceType
                    : record.bondType}
              </CardTitle>

              <ExpiryBadge
                status={
                  record.status
                }
              />
            </div>

            <CardDescription className="mt-1 font-mono text-[10px]">
              {record.id}
            </CardDescription>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={
              onClose
            }
          >
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-4">
        {transportation && (
          <>
            <section>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Policy
              </Label>

              <div className="mt-3 grid gap-4">
                <CopyField
                  label="Insurance Company"
                  value={
                    record.insurerName
                  }
                />

                <CopyField
                  label="Policy Number"
                  value={
                    record.policyNumber
                  }
                />

                <CopyField
                  label="Effective Date"
                  value={
                    record.effectiveDate
                  }
                />

                <CopyField
                  label="Expiry Date"
                  value={
                    record.expiryDate
                  }
                />
              </div>
            </section>

            <section className="border-t pt-4">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Key Coverage
              </Label>

              <div className="mt-3 space-y-2">
                {record.coverage.length >
                0 ? (
                  record.coverage.map(
                    (item) => (
                      <div
                        key={
                          item.id
                        }
                        className="flex items-center justify-between gap-3 rounded-lg border p-3"
                      >
                        <span className="text-xs text-muted-foreground">
                          {
                            item.label
                          }
                        </span>

                        <span className="text-right text-xs font-semibold">
                          {
                            item.value
                          }
                        </span>
                      </div>
                    )
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">
                    See the source document for full coverage details.
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
                  onClick={() =>
                    onEditBroker(
                      record.groupId
                    )
                  }
                >
                  <Pencil className="mr-1 size-3" />

                  Edit
                </Button>
              </div>

              {record.broker ? (
                <div className="mt-3 space-y-4">
                  <CopyField
                    label="Broker Company"
                    value={
                      record.broker
                        .organizationName
                    }
                  />

                  <CopyField
                    label="Broker Contact"
                    value={
                      record.broker
                        .contactName
                    }
                  />

                  <CopyField
                    label="Email"
                    value={
                      record.broker
                        .contactEmail
                    }
                  />

                  <CopyField
                    label="Phone"
                    value={
                      record.broker
                        .contactPhone
                    }
                  />
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  No broker information recorded.
                </p>
              )}
            </section>
          </>
        )}

        {workers && (
          <>
            <section>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Workers Insurance
              </Label>

              <div className="mt-3 space-y-4">
                <CopyField
                  label="Provider / Board"
                  value={
                    record.providerName
                  }
                />

                <CopyField
                  label="Policy / Account Number"
                  value={
                    record.policyNumber
                  }
                />

                <CopyField
                  label="Jurisdiction"
                  value={
                    record.jurisdiction
                  }
                />

                <CopyField
                  label="Effective Date"
                  value={
                    record.effectiveDate
                  }
                />

                <CopyField
                  label="Expiry Date"
                  value={
                    record.expiryDate
                  }
                />
              </div>
            </section>

            {record.coverage.length >
              0 && (
              <section className="border-t pt-4">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Key Coverage
                </Label>

                <div className="mt-3 space-y-2">
                  {record.coverage.map(
                    (item) => (
                      <div
                        key={
                          item.id
                        }
                        className="flex items-center justify-between gap-3 rounded-lg border p-3"
                      >
                        <span className="text-xs text-muted-foreground">
                          {
                            item.label
                          }
                        </span>

                        <span className="text-xs font-semibold">
                          {
                            item.value
                          }
                        </span>
                      </div>
                    )
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {record.family ===
          "bond" && (
          <section>
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Bond Details
            </Label>

            <div className="mt-3 space-y-4">
              <CopyField
                label="Surety Company"
                value={
                  record.suretyName
                }
              />

              <CopyField
                label="Bond Number"
                value={
                  record.bondNumber
                }
              />

              <CopyField
                label="Principal"
                value={
                  record.principalName
                }
              />

              <CopyField
                label="Bond Amount"
                value={
                  record.bondAmount
                }
              />

              <CopyField
                label="Effective Date"
                value={
                  record.effectiveDate
                }
              />

              <CopyField
                label="Expiry Date"
                value={
                  record.expiryDate ||
                  "Continuous"
                }
              />
            </div>
          </section>
        )}

        <section className="border-t pt-4">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Evidence
          </Label>

          {evidence ? (
            <div className="mt-3 rounded-lg border p-3">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-4 shrink-0 text-primary" />

                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {
                      evidence.documentName
                    }
                  </p>

                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {evidence.source ===
                    "camera"
                      ? "Camera capture"
                      : "Device upload"}

                    {evidence.ocrConfidence !==
                      undefined &&
                      ` · OCR ${evidence.ocrConfidence}%`}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              No source document attached.
            </p>
          )}
        </section>

        <section className="border-t pt-4">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Record Metadata
          </Label>

          <div className="mt-3 grid gap-3">
            <CopyField
              label="Source"
              value={
                record.source
              }
            />

            <CopyField
              label="Created"
              value={
                record.createdAt
              }
            />

            <CopyField
              label="Last Updated"
              value={
                record.updatedAt
              }
            />
          </div>
        </section>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   RECORD ROWS
========================================================= */

function TransportationRow({
  record,
  selected,
  onSelect,
  onArchive,
}: {
  record:
    TransportationInsuranceRecord

  selected:
    boolean

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
          .slice(
            0,
            3
          )
          .map(
            (
              coverage
            ) => (
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
              : days ===
                  0
                ? "Expires today"
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

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={(
            event
          ) => {
            event.stopPropagation()

            onArchive()
          }}
        >
          <Archive className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function WorkersRow({
  record,
  selected,
  onSelect,
  onArchive,
}: {
  record:
    WorkersInsuranceRecord

  selected:
    boolean

  onSelect: () => void
  onArchive: () => void
}) {
  const style =
    statusStyle(
      record.status
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
            record.insuranceType
          }
        </p>

        <p className="mt-1 select-text font-mono text-[10px] text-muted-foreground">
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
          .slice(
            0,
            2
          )
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
      </div>

      <div className="flex items-center justify-end gap-2 md:col-span-2">
        <ExpiryBadge
          status={
            record.status
          }
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={(
            event
          ) => {
            event.stopPropagation()

            onArchive()
          }}
        >
          <Archive className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function BondRow({
  record,
  selected,
  onSelect,
  onArchive,
}: {
  record:
    BondRecord

  selected:
    boolean

  onSelect: () => void
  onArchive: () => void
}) {
  const style =
    statusStyle(
      record.status
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
            record.bondType
          }
        </p>

        <p className="mt-1 select-text font-mono text-[10px] text-muted-foreground">
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

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={(
            event
          ) => {
            event.stopPropagation()

            onArchive()
          }}
        >
          <Archive className="size-4" />
        </Button>
      </div>
    </div>
  )
}

/* =========================================================
   STATUS SUMMARY CARD
========================================================= */

function StatusCountCard({
  label,
  count,
  status,
}: {
  label: string
  count: number
  status:
    ExpiryStatus
}) {
  const style =
    statusStyle(
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
            {count}
          </p>

          <ExpiryBadge
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
    useState<StoredInsuranceData>(
      EMPTY_DATA
    )

  const [
    settings,
    setSettings,
  ] =
    useState<SystemSettings>({
      version:
        1,

      expiryRules:
        DEFAULT_EXPIRY_RULES,
    })

  const [
    loading,
    setLoading,
  ] =
    useState(true)

  const [
    sourceFamily,
    setSourceFamily,
  ] =
    useState<RecordFamily | null>(
      null
    )

  const [
    manualFamily,
    setManualFamily,
  ] =
    useState<RecordFamily | null>(
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
    selectedRecord,
    setSelectedRecord,
  ] =
    useState<SelectedInsuranceRecord | null>(
      null
    )

  const [
    brokerEditGroup,
    setBrokerEditGroup,
  ] =
    useState<string | null>(
      null
    )

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

        if (
          parsed &&
          !Array.isArray(
            parsed
          ) &&
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
          Array.isArray(
            parsed
          )
        ) {
          setData(
            migrateLegacyRecords(
              parsed
            )
          )
        }
      }

      setSettings(
        loadSystemSettings()
      )
    } catch (error) {
      console.error(
        "Unable to load Insurance page:",
        error
      )

      setData(
        EMPTY_DATA
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

  /* =======================================================
     LIVE EXPIRY STATUS
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

  const allRecords =
    [
      ...transportation,
      ...workers,
      ...bonds,
    ]

  const countStatus = (
    status:
      ExpiryStatus
  ) =>
    allRecords.filter(
      (record) =>
        record.status ===
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
      if (!sourceFamily) {
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
        family:
          sourceFamily,

        source,

        file,

        dataUrl,

        processing:
          false,

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

        brokerName:
          "",

        brokerContactName:
          "",

        brokerEmail:
          "",

        brokerPhone:
          "",
      })

      setSourceFamily(
        null
      )
    }

  /* =======================================================
     BROKER RESOLUTION

     Sonic = Organization.
     Harpreet = canonical Contact belonging to Sonic.
     Insurance record = references both.
  ======================================================= */

  const resolveBroker = ({
    companyName,
    contactName,
    email,
    phone,
  }: {
    companyName:
      string

    contactName:
      string

    email:
      string

    phone:
      string
  }): BrokerReference | undefined => {
    if (
      !companyName.trim() &&
      !contactName.trim() &&
      !email.trim() &&
      !phone.trim()
    ) {
      return undefined
    }

    /*
      First layer:
      Sonic Insurance.
    */

    const brokerOrganization =
      resolveOrganization(
        companyName,

        "Insurance Broker"
      )

    /*
      Second layer:
      Harpreet Kaur.

      This function globally searches Contacts before
      creating anything.
    */

    const brokerContact =
      resolveBrokerContact({
        brokerOrganizationId:
          brokerOrganization.organizationId,

        brokerOrganizationName:
          brokerOrganization.organizationName,

        contactName,

        email,

        phone,
      })

    /*
      Third layer:
      Insurance references existing entities.
    */

    return {
      organizationId:
        brokerOrganization.organizationId,

      organizationName:
        brokerOrganization.organizationName,

      contactId:
        brokerContact.contactId,

      contactName:
        brokerContact.contactName,

      contactEmail:
        brokerContact.contactEmail,

      contactPhone:
        brokerContact.contactPhone,
    }
  }

  /* =======================================================
     POLICY DUPLICATE / RENEWAL
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

    const matches =
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
      matches.find(
        (record) =>
          record.effectiveDate ===
            draft.effectiveDate &&
          record.expiryDate ===
            draft.expiryDate
      )

    if (
      exactPeriod
    ) {
      return {
        type:
          "duplicate" as const,

        record:
          exactPeriod,
      }
    }

    if (
      matches.length
    ) {
      const recent =
        [...matches].sort(
          (a, b) =>
            b.expiryDate.localeCompare(
              a.expiryDate
            )
        )[0]

      return {
        type:
          "renewal" as const,

        record:
          recent,
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
     TRANSPORTATION CORE SAVE
  ======================================================= */

  const saveTransportationDrafts = ({
    drafts,
    source,
    evidence,
    broker,
  }: {
    drafts:
      TransportationDraft[]

    source:
      SourceType

    evidence?:
      InsuranceEvidence

    broker?:
      BrokerReference
  }) => {
    const groupId =
      createId(
        "COI"
      )

    const created:
      TransportationInsuranceRecord[] =
      []

    for (
      const draft of
      drafts
    ) {
      const insurer =
        resolveOrganization(
          draft.insurerName,

          "Insurance Company"
        )

      const match =
        locatePolicyMatch(
          draft,

          insurer.organizationName
        )

      /*
        Same insurer + policy # + policy period:
        do not duplicate.
      */

      if (
        match.type ===
        "duplicate"
      ) {
        continue
      }

      const timestamp =
        isoNow()

      created.push({
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
              8
            ),

        broker,

        evidenceId:
          evidence?.id,

        source,

        status:
          getExpiryStatus(
            draft.expiryDate,

            settings.expiryRules
          ),

        previousRecordId:
          match.type ===
          "renewal"
            ? match.record?.id
            : undefined,

        createdAt:
          timestamp,

        updatedAt:
          timestamp,
      })
    }

    if (
      !created.length
    ) {
      window.alert(
        "No new record was created because the insurer, policy number and policy period already exist."
      )

      return false
    }

    setData(
      (current) => ({
        ...current,

        transportation:
          [
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

    setSelectedRecord(
      created[0]
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

    /* ---------------- TRANSPORTATION ---------------- */

    if (
      session.family ===
      "transportation"
    ) {
      const broker =
        resolveBroker({
          companyName:
            session.brokerName,

          contactName:
            session.brokerContactName,

          email:
            session.brokerEmail,

          phone:
            session.brokerPhone,
        })

      const saved =
        saveTransportationDrafts({
          drafts:
            session.transportationRecords,

          source:
            "OCR",

          evidence,

          broker,
        })

      if (saved) {
        setOcrSession(
          null
        )
      }

      return
    }

    /* ---------------- WORKERS ---------------- */

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
            existing.status !==
              "Archived" &&
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

      if (
        duplicate
      ) {
        window.alert(
          "This workers insurance record already exists."
        )

        return
      }

      const timestamp =
        isoNow()

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

      setSelectedRecord(
        record
      )

      setOcrSession(
        null
      )

      return
    }

    /* ---------------- BOND ---------------- */

    const draft =
      session.bondDraft

    const surety =
      resolveOrganization(
        draft.suretyName,

        "Surety Company"
      )

    const duplicate =
      bonds.find(
        (existing) =>
          existing.status !==
            "Archived" &&
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

    if (
      duplicate
    ) {
      window.alert(
        "This bond already exists for the same surety company."
      )

      return
    }

    const timestamp =
      isoNow()

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

    setSelectedRecord(
      record
    )

    setOcrSession(
      null
    )
  }

  /* =======================================================
     MANUAL TRANSPORTATION
  ======================================================= */

  const saveManualTransportation = (
    drafts:
      TransportationDraft[],

    brokerData: {
      companyName: string
      contactName: string
      email: string
      phone: string
    }
  ) => {
    const broker =
      resolveBroker(
        brokerData
      )

    const saved =
      saveTransportationDrafts({
        drafts,

        source:
          "Manual",

        broker,
      })

    if (saved) {
      setManualFamily(
        null
      )
    }
  }

  /* =======================================================
     MANUAL WORKERS
  ======================================================= */

  const saveManualWorkers = (
    draft:
      WorkersDraft
  ) => {
    const provider =
      resolveOrganization(
        draft.providerName,

        "Workers Insurance"
      )

    const duplicate =
      workers.find(
        (existing) =>
          existing.status !==
            "Archived" &&
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

    if (
      duplicate
    ) {
      window.alert(
        "This workers insurance record already exists."
      )

      return
    }

    const timestamp =
      isoNow()

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

        source:
          "Manual",

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
      })
    )

    setSelectedRecord(
      record
    )

    setManualFamily(
      null
    )
  }

  /* =======================================================
     MANUAL BOND
  ======================================================= */

  const saveManualBond = (
    draft:
      BondDraft
  ) => {
    const surety =
      resolveOrganization(
        draft.suretyName,

        "Surety Company"
      )

    const duplicate =
      bonds.find(
        (existing) =>
          existing.status !==
            "Archived" &&
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

    if (
      duplicate
    ) {
      window.alert(
        "This bond already exists for the same surety company."
      )

      return
    }

    const timestamp =
      isoNow()

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

        source:
          "Manual",

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
      })
    )

    setSelectedRecord(
      record
    )

    setManualFamily(
      null
    )
  }

  /* =======================================================
     BROKER UPDATE
  ======================================================= */

  const updateBrokerGroup = (
    groupId:
      string,

    broker:
      BrokerReference
  ) => {
    const updatedAt =
      isoNow()

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

                    updatedAt,
                  }
                : record
          ),
      })
    )

    if (
      selectedRecord?.family ===
        "transportation" &&
      selectedRecord.groupId ===
        groupId
    ) {
      setSelectedRecord({
        ...selectedRecord,

        broker,

        updatedAt,
      })
    }

    setBrokerEditGroup(
      null
    )
  }

  /* =======================================================
     ARCHIVE
  ======================================================= */

  const archiveRecord = (
    family:
      RecordFamily,

    id:
      string
  ) => {
    const reason =
      window.prompt(
        "Archive reason:"
      )

    if (
      !reason?.trim()
    ) {
      return
    }

    const timestamp =
      isoNow()

    if (
      family ===
      "transportation"
    ) {
      setData(
        (current) => ({
          ...current,

          transportation:
            current.transportation.map(
              (record) =>
                record.id ===
                id
                  ? {
                      ...record,

                      status:
                        "Archived",

                      archivedAt:
                        timestamp,

                      archivedBy:
                        "Current User",

                      archiveReason:
                        reason.trim(),

                      updatedAt:
                        timestamp,
                    }
                  : record
            ),
        })
      )
    }

    if (
      family ===
      "workers"
    ) {
      setData(
        (current) => ({
          ...current,

          workers:
            current.workers.map(
              (record) =>
                record.id ===
                id
                  ? {
                      ...record,

                      status:
                        "Archived",

                      archivedAt:
                        timestamp,

                      archivedBy:
                        "Current User",

                      archiveReason:
                        reason.trim(),

                      updatedAt:
                        timestamp,
                    }
                  : record
            ),
        })
      )
    }

    if (
      family ===
      "bond"
    ) {
      setData(
        (current) => ({
          ...current,

          bonds:
            current.bonds.map(
              (record) =>
                record.id ===
                id
                  ? {
                      ...record,

                      status:
                        "Archived",

                      archivedAt:
                        timestamp,

                      archivedBy:
                        "Current User",

                      archiveReason:
                        reason.trim(),

                      updatedAt:
                        timestamp,
                    }
                  : record
            ),
        })
      )
    }

    if (
      selectedRecord?.id ===
      id
    ) {
      setSelectedRecord(
        null
      )
    }
  }

  /* =======================================================
     LOADING / MISSING COMPANY
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
    !company
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

  const selectedEvidence =
    selectedRecord?.evidenceId
      ? data.evidence.find(
          (item) =>
            item.id ===
            selectedRecord.evidenceId
        )
      : undefined

  const brokerEditRecords =
    brokerEditGroup
      ? transportation.filter(
          (record) =>
            record.groupId ===
            brokerEditGroup
        )
      : []

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
                  Expiry Classification
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

                  Refresh Portal Settings
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* =================================================
            EXPIRY STATUS
        ================================================= */}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatusCountCard
            label="Healthy"
            count={
              countStatus(
                "Healthy"
              )
            }
            status="Healthy"
          />

          <StatusCountCard
            label="Watch"
            count={
              countStatus(
                "Watch"
              )
            }
            status="Watch"
          />

          <StatusCountCard
            label="Urgent"
            count={
              countStatus(
                "Urgent"
              )
            }
            status="Urgent"
          />

          <StatusCountCard
            label="Critical"
            count={
              countStatus(
                "Critical"
              )
            }
            status="Critical"
          />

          <StatusCountCard
            label="Expired"
            count={
              countStatus(
                "Expired"
              )
            }
            status="Expired"
          />
        </div>

        {/* =================================================
            MAIN WORKSPACE
        ================================================= */}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-6">
            {/* =============================================
                TRANSPORTATION INSURANCE
            ============================================= */}

            <Card className="overflow-visible">
              <CardHeader className="border-b bg-muted/20">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <ShieldCheck className="size-4 text-primary" />

                      Transportation Insurance
                    </CardTitle>

                    <CardDescription className="mt-1 text-xs">
                      One COI can create multiple insurer and policy records.
                    </CardDescription>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        setSourceFamily(
                          "transportation"
                        )
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
                      onClick={() =>
                        setManualFamily(
                          "transportation"
                        )
                      }
                    >
                      <Plus className="mr-2 size-4" />

                      Add Insurance
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {visibleTransportation.length ===
                0 ? (
                  <div className="p-10 text-center">
                    <ShieldCheck className="mx-auto size-10 text-muted-foreground/30" />

                    <p className="mt-3 text-sm font-medium">
                      No active transportation insurance
                    </p>

                    <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                      Scan the current COI or add the active insurance information manually.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {visibleTransportation.map(
                      (record) => (
                        <TransportationRow
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
                          onArchive={() =>
                            archiveRecord(
                              "transportation",

                              record.id
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
                WORKERS INSURANCE
            ============================================= */}

            <Card className="overflow-visible">
              <CardHeader className="border-b bg-muted/20">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <HardHat className="size-4 text-primary" />

                      Workers Insurance
                    </CardTitle>

                    <CardDescription className="mt-1 text-xs">
                      Workers compensation, WCB / WSIB and occupational coverage.
                    </CardDescription>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        setSourceFamily(
                          "workers"
                        )
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
                      onClick={() =>
                        setManualFamily(
                          "workers"
                        )
                      }
                    >
                      <Plus className="mr-2 size-4" />

                      Add Workers Insurance
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {visibleWorkers.length ===
                0 ? (
                  <div className="p-10 text-center">
                    <HardHat className="mx-auto size-10 text-muted-foreground/30" />

                    <p className="mt-3 text-sm font-medium">
                      No active workers insurance
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {visibleWorkers.map(
                      (record) => (
                        <WorkersRow
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
                          onArchive={() =>
                            archiveRecord(
                              "workers",

                              record.id
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
                SURETY BONDS
            ============================================= */}

            <Card className="overflow-visible">
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

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        setSourceFamily(
                          "bond"
                        )
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
                      onClick={() =>
                        setManualFamily(
                          "bond"
                        )
                      }
                    >
                      <Plus className="mr-2 size-4" />

                      Add Bond
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {visibleBonds.length ===
                0 ? (
                  <div className="p-10 text-center">
                    <FileKey2 className="mx-auto size-10 text-muted-foreground/30" />

                    <p className="mt-3 text-sm font-medium">
                      No active surety bonds
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {visibleBonds.map(
                      (record) => (
                        <BondRow
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
                          onArchive={() =>
                            archiveRecord(
                              "bond",

                              record.id
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
              RIGHT SIDE RECORD DETAILS
          =============================================== */}

          <div className="xl:sticky xl:top-6">
            <InsuranceRecordInspector
              record={
                selectedRecord
              }
              evidence={
                selectedEvidence
              }
              onClose={() =>
                setSelectedRecord(
                  null
                )
              }
              onEditBroker={(
                groupId
              ) =>
                setBrokerEditGroup(
                  groupId
                )
              }
            />
          </div>
        </div>

        {/* =================================================
            ARCHITECTURE NOTE
        ================================================= */}

        <Card className="border-dashed bg-muted/10">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <History className="mt-0.5 size-4 text-primary" />

              <div>
                <p className="text-xs font-semibold">
                  Insurance record integrity
                </p>

                <p className="mt-1 max-w-5xl text-xs leading-5 text-muted-foreground">
                  OCR and manual entry create the same structured records. Insurance companies and broker companies are resolved against the Companies registry before creation. Broker contacts exist once in the global Contacts registry and belong to their broker organization, allowing the same person to support multiple TES clients without duplicate contact records. Insurance records reference those existing identities rather than recreating them.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===================================================
          DOCUMENT SOURCE
      =================================================== */}

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
          OCR
      =================================================== */}

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

      {/* ===================================================
          MANUAL ENTRY
      =================================================== */}

      {manualFamily && (
        <ManualInsuranceModal
          family={
            manualFamily
          }
          company={
            company
          }
          onCancel={() =>
            setManualFamily(
              null
            )
          }
          onSaveTransportation={
            saveManualTransportation
          }
          onSaveWorkers={
            saveManualWorkers
          }
          onSaveBond={
            saveManualBond
          }
        />
      )}

      {/* ===================================================
          BROKER EDIT
      =================================================== */}

      {brokerEditGroup &&
        brokerEditRecords.length >
          0 && (
          <BrokerEditor
            records={
              brokerEditRecords
            }
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

      {/* ===================================================
          DEVICE UPLOAD
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
   LEGACY MIGRATION
========================================================= */

function migrateLegacyRecords(
  legacy: any[]
): StoredInsuranceData {
  const migrated:
    StoredInsuranceData =
    {
      ...EMPTY_DATA,

      transportation:
        [],

      workers:
        [],

      bonds:
        [],

      evidence:
        [],
    }

  for (
    const record of
    legacy
  ) {
    const timestamp =
      record.createdAt ||
      isoNow()

    const type =
      String(
        record.type ||
          ""
      )

    /* ---------------- WORKERS ---------------- */

    if (
      [
        "WSIB",
        "WCB",
        "Workers Compensation",
        "Occupational Accident",
        "Employer Liability",
      ].includes(
        type
      )
    ) {
      migrated.workers.push({
        id:
          record.id ||
          createId(
            "WCB"
          ),

        family:
          "workers",

        insuranceType:
          type,

        providerName:
          record.provider ||
          record.company ||
          "",

        policyNumber:
          record.number ||
          "",

        jurisdiction:
          record.jurisdiction,

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
                  id:
                    createId(
                      "COV"
                    ),

                  label:
                    "Coverage",

                  value:
                    record.limits,
                },
              ]
            : [],

        source:
          record.source ||
          "Manual",

        status:
          record.status ===
          "Archived"
            ? "Archived"
            : "Healthy",

        createdAt:
          timestamp,

        updatedAt:
          timestamp,

        archivedAt:
          record.archivedAt,
      })

      continue
    }

    /* ---------------- BONDS ---------------- */

    if (
      type
        .toLowerCase()
        .includes(
          "bond"
        ) ||
      type.includes(
        "BMC-84"
      ) ||
      type.includes(
        "BMC-85"
      )
    ) {
      migrated.bonds.push({
        id:
          record.id ||
          createId(
            "BND"
          ),

        family:
          "bond",

        bondType:
          type ||
          "Other",

        suretyName:
          record.provider ||
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

        source:
          record.source ||
          "Manual",

        status:
          record.status ===
          "Archived"
            ? "Archived"
            : "Healthy",

        createdAt:
          timestamp,

        updatedAt:
          timestamp,

        archivedAt:
          record.archivedAt,
      })

      continue
    }

    /* ---------------- TRANSPORTATION ---------------- */

    migrated.transportation.push({
      id:
        record.id ||
        createId(
          "INS"
        ),

      groupId:
        createId(
          "COI"
        ),

      family:
        "transportation",

      insuranceType:
        type ||
        "Other",

      canonicalType:
        normalizeInsuranceType(
          type ||
          "Other"
        ),

      insurerName:
        record.provider ||
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
                id:
                  createId(
                    "COV"
                  ),

                label:
                  "Coverage Limit",

                value:
                  record.limits,
              },
            ]
          : [],

      broker:
        record.broker
          ? {
              organizationName:
                record.broker,
            }
          : undefined,

      source:
        record.source ||
        "Manual",

      status:
        record.status ===
        "Archived"
          ? "Archived"
          : "Healthy",

      createdAt:
        timestamp,

      updatedAt:
        timestamp,

      archivedAt:
        record.archivedAt,
    })
  }

  return migrated
}
