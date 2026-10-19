"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  ChevronDown,
  FileBadge,
  Info,
  MapPin,
  Save,
  Truck,
  UserRound,
  ShieldAlert,
  XCircle,
} from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"

/* =========================================================
   TYPES
========================================================= */

type Region = {
  code: string
  name: string
  country: "Canada" | "United States"
}

type DuplicateSeverity = "block" | "review"

type DuplicateFinding = {
  id: string
  severity: DuplicateSeverity
  field: string
  label: string
  value: string
  matchedRecordId?: string
  matchedRecordName?: string
  source?: string
  message: string
}

type PortalRecord = {
  data: Record<string, any>
  source: string
}

type DuplicateRule = {
  key: string
  label: string
  aliases: string[]
  normalizer: "identifier" | "phone" | "email"
}

/* =========================================================
   CONSTANTS
========================================================= */

const CARGO_OPTIONS = [
  "General Freight",
  "Specialized Equipment",
  "Household Goods",
  "Temperature-Controlled & Food",
  "Hazardous Materials",
  "Bulk & Other",
]

/**
 * "Cargo Information" is mandatory for a Customer in the original TES form. Cargo categories now have a canonical owner
 * (company_cargo_category_periods, migration 0033), so the original rule is enforced again. The categories are descriptive; they
 * are never a compliance claim. See docs/recovery/canonical-field-ownership.md.
 */
const CARGO_STORAGE_AVAILABLE = true

const COMPANY_TYPES = [
  "Customer",
  "Prospect",
  "Owner Operator",
  "Service Provider",
  "Finance/ Leasing Company",
  "Insurance Broker",
  "Insurance Company",
  "Workers Insurance",
  "Employee Reference",
  "Government Agency",
  "Sub Contractor",
  "Other",
]

/*
  IMPORTANT:
  These keys intentionally match the current TES company object.

  Aliases allow this page to detect legacy/inconsistent names that
  may already exist elsewhere in the current prototype.
*/
const STRICT_DUPLICATE_RULES: DuplicateRule[] = [
  {
    key: "incorpNo",
    label: "Incorporation / Charter Number",
    aliases: ["incorpNo", "incorporationNumber"],
    normalizer: "identifier",
  },
  {
    key: "businessNo",
    label: "Business Number",
    aliases: ["businessNo", "businessNumber"],
    normalizer: "identifier",
  },
  {
    key: "ein",
    label: "EIN",
    aliases: ["ein"],
    normalizer: "identifier",
  },
  {
    key: "gstHst",
    label: "GST / HST / Tax Registration",
    aliases: ["gstHst", "gstNumber", "taxRegistrationNo"],
    normalizer: "identifier",
  },
  {
    key: "mvid",
    label: "MVID / RIN",
    aliases: ["mvid", "mvidRin"],
    normalizer: "identifier",
  },
  {
    key: "nsc",
    label: "NSC / CVOR",
    aliases: ["nsc", "nscCvor"],
    normalizer: "identifier",
  },
  {
    key: "usdot",
    label: "USDOT Number",
    aliases: ["usdot", "usDotNumber", "dotNumber"],
    normalizer: "identifier",
  },
  {
    key: "mc",
    label: "MC Number",
    aliases: ["mc", "mcNumber"],
    normalizer: "identifier",
  },
  {
    key: "accIrp",
    label: "IRP Account",
    aliases: ["accIrp", "irpAccount"],
    normalizer: "identifier",
  },
  {
    key: "accIfta",
    label: "IFTA Account",
    aliases: ["accIfta", "iftaAccount"],
    normalizer: "identifier",
  },
  {
    key: "accNyhut",
    label: "NY HUT Account",
    aliases: ["accNyhut", "nyHut"],
    normalizer: "identifier",
  },
  {
    key: "accNm",
    label: "NM WDT Account",
    aliases: ["accNm", "nmWdt"],
    normalizer: "identifier",
  },
  {
    key: "accKyu",
    label: "Kentucky KYU",
    aliases: ["accKyu", "kyu"],
    normalizer: "identifier",
  },
  {
    key: "accOr",
    label: "Oregon Account",
    aliases: ["accOr", "oregonAccount"],
    normalizer: "identifier",
  },
  {
    key: "accCt",
    label: "CT DRS Account",
    aliases: ["accCt", "connecticutDrs"],
    normalizer: "identifier",
  },
  {
    key: "scac",
    label: "SCAC",
    aliases: ["scac"],
    normalizer: "identifier",
  },
  {
    key: "carrierCode",
    label: "Carrier Code",
    aliases: ["carrierCode"],
    normalizer: "identifier",
  },
]

/*
  Complete Canada + United States jurisdiction list.

  The previous file contained only a small subset and a TODO comment,
  which is dangerous because registration jurisdiction drives other
  company pages.
*/
const REGIONS = ([
  // Canada
  { code: "AB", name: "Alberta", country: "Canada" },
  { code: "BC", name: "British Columbia", country: "Canada" },
  { code: "MB", name: "Manitoba", country: "Canada" },
  { code: "NB", name: "New Brunswick", country: "Canada" },
  { code: "NL", name: "Newfoundland and Labrador", country: "Canada" },
  { code: "NS", name: "Nova Scotia", country: "Canada" },
  { code: "NT", name: "Northwest Territories", country: "Canada" },
  { code: "NU", name: "Nunavut", country: "Canada" },
  { code: "ON", name: "Ontario", country: "Canada" },
  { code: "PE", name: "Prince Edward Island", country: "Canada" },
  { code: "QC", name: "Quebec", country: "Canada" },
  { code: "SK", name: "Saskatchewan", country: "Canada" },
  { code: "YT", name: "Yukon", country: "Canada" },

  // United States
  { code: "AL", name: "Alabama", country: "United States" },
  { code: "AK", name: "Alaska", country: "United States" },
  { code: "AZ", name: "Arizona", country: "United States" },
  { code: "AR", name: "Arkansas", country: "United States" },
  { code: "CA", name: "California", country: "United States" },
  { code: "CO", name: "Colorado", country: "United States" },
  { code: "CT", name: "Connecticut", country: "United States" },
  { code: "DE", name: "Delaware", country: "United States" },
  { code: "DC", name: "District of Columbia", country: "United States" },
  { code: "FL", name: "Florida", country: "United States" },
  { code: "GA", name: "Georgia", country: "United States" },
  { code: "HI", name: "Hawaii", country: "United States" },
  { code: "ID", name: "Idaho", country: "United States" },
  { code: "IL", name: "Illinois", country: "United States" },
  { code: "IN", name: "Indiana", country: "United States" },
  { code: "IA", name: "Iowa", country: "United States" },
  { code: "KS", name: "Kansas", country: "United States" },
  { code: "KY", name: "Kentucky", country: "United States" },
  { code: "LA", name: "Louisiana", country: "United States" },
  { code: "ME", name: "Maine", country: "United States" },
  { code: "MD", name: "Maryland", country: "United States" },
  { code: "MA", name: "Massachusetts", country: "United States" },
  { code: "MI", name: "Michigan", country: "United States" },
  { code: "MN", name: "Minnesota", country: "United States" },
  { code: "MS", name: "Mississippi", country: "United States" },
  { code: "MO", name: "Missouri", country: "United States" },
  { code: "MT", name: "Montana", country: "United States" },
  { code: "NE", name: "Nebraska", country: "United States" },
  { code: "NV", name: "Nevada", country: "United States" },
  { code: "NH", name: "New Hampshire", country: "United States" },
  { code: "NJ", name: "New Jersey", country: "United States" },
  { code: "NM", name: "New Mexico", country: "United States" },
  { code: "NY", name: "New York", country: "United States" },
  { code: "NC", name: "North Carolina", country: "United States" },
  { code: "ND", name: "North Dakota", country: "United States" },
  { code: "OH", name: "Ohio", country: "United States" },
  { code: "OK", name: "Oklahoma", country: "United States" },
  { code: "OR", name: "Oregon", country: "United States" },
  { code: "PA", name: "Pennsylvania", country: "United States" },
  { code: "RI", name: "Rhode Island", country: "United States" },
  { code: "SC", name: "South Carolina", country: "United States" },
  { code: "SD", name: "South Dakota", country: "United States" },
  { code: "TN", name: "Tennessee", country: "United States" },
  { code: "TX", name: "Texas", country: "United States" },
  { code: "UT", name: "Utah", country: "United States" },
  { code: "VT", name: "Vermont", country: "United States" },
  { code: "VA", name: "Virginia", country: "United States" },
  { code: "WA", name: "Washington", country: "United States" },
  { code: "WV", name: "West Virginia", country: "United States" },
  { code: "WI", name: "Wisconsin", country: "United States" },
  { code: "WY", name: "Wyoming", country: "United States" },
] satisfies Region[]).sort((a, b) => a.name.localeCompare(b.name))

/* =========================================================
   NORMALIZATION
========================================================= */

function normalizeIdentifier(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "")

  // Ignore common +1 prefix when comparing North American numbers.
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function normalizeAddress(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(highway|hwy)\b/g, "hwy")
    .replace(/\b(suite|ste)\b/g, "ste")
    .replace(/[^a-z0-9]/g, "")
}

function normalizeCompanyName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(
      /\b(incorporated|inc|corporation|corp|company|co|limited|ltd|llc|l\.l\.c)\b/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim()
}

function normalizePersonName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
}

/* =========================================================
   LEVENSHTEIN
========================================================= */

function getLevenshteinDistance(a: string, b: string) {
  if (!a.length) return b.length
  if (!b.length) return a.length

  const matrix: number[][] = Array.from(
    { length: b.length + 1 },
    () => Array(a.length + 1).fill(0)
  )

  for (let i = 0; i <= b.length; i++) {
    matrix[i][0] = i
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }

  return matrix[b.length][a.length]
}

function getSimilarity(a: string, b: string) {
  if (!a || !b) return 0

  const distance = getLevenshteinDistance(a, b)
  const maxLength = Math.max(a.length, b.length)

  if (!maxLength) return 100

  return ((maxLength - distance) / maxLength) * 100
}

function getPortalRecords(): PortalRecord[] {
  return []
}

function getRecordName(record: Record<string, any>) {
  if (record.name) return String(record.name)

  if (record.companyName) return String(record.companyName)

  if (record.firstName || record.lastName) {
    return `${record.firstName || ""} ${record.lastName || ""}`.trim()
  }

  if (record.type) return String(record.type)

  return "Existing TES record"
}

function getRecordId(record: Record<string, any>) {
  return (
    record.id ||
    record.globalId ||
    record.companyId ||
    record.recordId ||
    undefined
  )
}

/* =========================================================
   DUPLICATE ENGINE
========================================================= */

function normalizeByRule(
  value: string,
  rule: DuplicateRule
) {
  switch (rule.normalizer) {
    case "phone":
      return normalizePhone(value)

    case "email":
      return normalizeEmail(value)

    default:
      return normalizeIdentifier(value)
  }
}

function addFinding(
  findings: DuplicateFinding[],
  finding: DuplicateFinding
) {
  const alreadyExists = findings.some(
    (existing) =>
      existing.severity === finding.severity &&
      existing.label === finding.label &&
      existing.value === finding.value &&
      existing.matchedRecordId === finding.matchedRecordId &&
      existing.matchedRecordName === finding.matchedRecordName
  )

  if (!alreadyExists) {
    findings.push(finding)
  }
}

function evaluateDuplicates(form: HTMLFormElement) {
  const formData = new FormData(form)
  const portalRecords = getPortalRecords()

  const blocking: DuplicateFinding[] = []
  const review: DuplicateFinding[] = []

  /* ---------------------------------------------------------
     1. HARD UNIQUE IDENTIFIERS
  --------------------------------------------------------- */

  STRICT_DUPLICATE_RULES.forEach((rule) => {
    const candidateRaw = String(formData.get(rule.key) || "").trim()

    if (!candidateRaw) return

    const candidate = normalizeByRule(candidateRaw, rule)

    // Do not compare meaningless tiny identifier fragments.
    if (candidate.length < 3) return

    portalRecords.forEach(({ data, source }) => {
      for (const alias of rule.aliases) {
        const storedRaw = data[alias]

        if (
          storedRaw === undefined ||
          storedRaw === null ||
          String(storedRaw).trim() === ""
        ) {
          continue
        }

        const stored = normalizeByRule(String(storedRaw), rule)

        if (candidate !== stored) continue

        addFinding(blocking, {
          id: `BLOCK-${rule.key}-${getRecordId(data) || source}`,
          severity: "block",
          field: rule.key,
          label: rule.label,
          value: candidateRaw,
          matchedRecordId: getRecordId(data),
          matchedRecordName: getRecordName(data),
          source,
          message:
            `${rule.label} "${candidateRaw}" already exists in TES. ` +
            `A strong identifier cannot be silently assigned to a second active identity.`,
        })

        break
      }
    })
  })

  /* ---------------------------------------------------------
     2. COMPANY NAME

     Name by itself NEVER auto-links identities.
  --------------------------------------------------------- */

  const companyName = String(
    formData.get("companyName") || ""
  ).trim()

  if (companyName.length >= 3) {
    const normalizedCandidate = normalizeCompanyName(companyName)

    portalRecords.forEach(({ data, source }) => {
      if (!data.name || !data.id?.toString().startsWith("CMP-")) return

      const existingName = String(data.name)
      const normalizedExisting = normalizeCompanyName(existingName)

      const exact =
        normalizedCandidate === normalizedExisting

      const similarity = getSimilarity(
        normalizedCandidate,
        normalizedExisting
      )

      if (exact || similarity >= 88) {
        addFinding(review, {
          id: `NAME-${data.id}`,
          severity: "review",
          field: "companyName",
          label: "Company Name",
          value: companyName,
          matchedRecordId: data.id,
          matchedRecordName: existingName,
          source,
          message: exact
            ? `The company name closely matches "${existingName}". Name alone does not prove duplicate identity; review the other identifiers before proceeding.`
            : `The company name is ${Math.round(
                similarity
              )}% similar to "${existingName}". Review before creating a separate company.`,
        })
      }
    })
  }

  /* ---------------------------------------------------------
     3. PHONE NUMBER

     Detect, but do not automatically merge because numbers
     can be shared by dispatch offices, accountants, families,
     consultants, etc.
  --------------------------------------------------------- */

  const phoneRaw = String(formData.get("phone") || "").trim()

  if (phoneRaw) {
    const phone = normalizePhone(phoneRaw)

    if (phone.length >= 7) {
      portalRecords.forEach(({ data, source }) => {
        const possiblePhones = [
          data.phone,
          data.contactNumber,
          data.phoneNumber,
        ].filter(Boolean)

        possiblePhones.forEach((existingPhone) => {
          if (
            normalizePhone(String(existingPhone)) === phone
          ) {
            addFinding(review, {
              id: `PHONE-${getRecordId(data) || source}`,
              severity: "review",
              field: "phone",
              label: "Phone Number",
              value: phoneRaw,
              matchedRecordId: getRecordId(data),
              matchedRecordName: getRecordName(data),
              source,
              message:
                `This phone number already appears on "${getRecordName(
                  data
                )}". Confirm whether this is a shared contact or an existing identity.`,
            })
          }
        })
      })
    }
  }

  /* ---------------------------------------------------------
     4. EMAILS
  --------------------------------------------------------- */

  const emailCandidates = [
    {
      key: "email",
      label: "Account Email",
      value: String(formData.get("email") || "").trim(),
    },
    {
      key: "billingEmail",
      label: "Billing Email",
      value: String(formData.get("billingEmail") || "").trim(),
    },
  ]

  emailCandidates.forEach((candidate) => {
    if (!candidate.value) return

    const normalized = normalizeEmail(candidate.value)

    portalRecords.forEach(({ data, source }) => {
      const emails = [
        data.email,
        data.accountEmail,
        data.billingEmail,
      ].filter(Boolean)

      emails.forEach((existingEmail) => {
        if (
          normalizeEmail(String(existingEmail)) === normalized
        ) {
          addFinding(review, {
            id: `EMAIL-${candidate.key}-${getRecordId(data) || source}`,
            severity: "review",
            field: candidate.key,
            label: candidate.label,
            value: candidate.value,
            matchedRecordId: getRecordId(data),
            matchedRecordName: getRecordName(data),
            source,
            message:
              `${candidate.label} already appears on "${getRecordName(
                data
              )}". Review the relationship before creating a separate record.`,
          })
        }
      })
    })
  })

  /* ---------------------------------------------------------
     5. PRIMARY CONTACT NAME

     Same name alone is NEVER treated as proof.
  --------------------------------------------------------- */

  const contactName = String(
    formData.get("contactPerson") || ""
  ).trim()

  if (contactName.length >= 3) {
    const normalizedContact = normalizePersonName(contactName)

    portalRecords.forEach(({ data, source }) => {
      let existingName = ""

      if (data.firstName || data.lastName) {
        existingName = `${data.firstName || ""} ${
          data.lastName || ""
        }`.trim()
      } else if (data.contact) {
        existingName = String(data.contact)
      } else if (data.contactPerson) {
        existingName = String(data.contactPerson)
      }

      if (!existingName) return

      const normalizedExisting = normalizePersonName(existingName)

      if (!normalizedExisting) return

      const similarity = getSimilarity(
        normalizedContact,
        normalizedExisting
      )

      if (
        normalizedContact === normalizedExisting ||
        similarity >= 92
      ) {
        addFinding(review, {
          id: `CONTACT-NAME-${getRecordId(data) || source}`,
          severity: "review",
          field: "contactPerson",
          label: "Contact Name",
          value: contactName,
          matchedRecordId: getRecordId(data),
          matchedRecordName: getRecordName(data),
          source,
          message:
            `"${contactName}" resembles an existing contact name. ` +
            `A name match alone does not establish identity; compare phone, email, licence or other authoritative identifiers.`,
        })
      }
    })
  }

  /* ---------------------------------------------------------
     6. REGISTERED ADDRESS
  --------------------------------------------------------- */

  const candidateAddressParts = [
    formData.get("reg_street"),
    formData.get("reg_city"),
    formData.get("reg_state"),
    formData.get("reg_zip"),
    formData.get("reg_country"),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)

  if (candidateAddressParts.length >= 3) {
    const candidateAddress = normalizeAddress(
      candidateAddressParts.join(" ")
    )

    portalRecords.forEach(({ data, source }) => {
      const existingParts = [
        data.reg_street,
        data.reg_city,
        data.reg_state,
        data.reg_zip,
        data.reg_country,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)

      if (existingParts.length < 3) return

      const existingAddress = normalizeAddress(
        existingParts.join(" ")
      )

      if (
        candidateAddress &&
        candidateAddress === existingAddress
      ) {
        addFinding(review, {
          id: `ADDRESS-${getRecordId(data) || source}`,
          severity: "review",
          field: "registeredAddress",
          label: "Registered Address",
          value: candidateAddressParts.join(", "),
          matchedRecordId: getRecordId(data),
          matchedRecordName: getRecordName(data),
          source,
          message:
            `This registered address already appears on "${getRecordName(
              data
            )}". Shared addresses are possible, so review rather than automatically linking records.`,
        })
      }
    })
  }

  return {
    blocking,
    review,
  }
}
/* =========================================================
   SMALL FORM PARTS
========================================================= */

/** CRA GST/HST program account: nine digits, RT, four digits (spaces and hyphens are not significant). */
const GST_HST_PATTERN = /^\d{9}[\s-]*RT[\s-]*\d{4}$/i

function Field({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  className = "",
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  /** Only for a genuinely ambiguous field: shown as a tooltip, never as text under the input. */
  hint?: string
  error?: string | null
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label htmlFor={htmlFor} className="gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive" aria-hidden="true">*</span>}
        {hint && (
          <span tabIndex={0} role="img" title={hint} aria-label={hint} className="inline-flex cursor-help text-muted-foreground">
            <Info className="size-3.5" />
          </span>
        )}
      </Label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  accent = false,
  grid = true,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  accent?: boolean
  grid?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      {accent && <div className="h-0.5 bg-gradient-to-r from-primary via-primary/60 to-transparent" aria-hidden="true" />}
      <header className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-2.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
          <Icon className="size-3.5" />
        </span>
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
      </header>
      <div className={grid ? "grid gap-x-4 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-4" : "space-y-5 p-4"}>{children}</div>
    </section>
  )
}

/* =========================================================
   PRIMARY CONTACT

   One field. A full name is saved exactly as typed (Contacts stays authoritative for the person and can restructure it). When
   people with the same name already exist they are offered as an explicit CHOICE; nothing is linked or merged automatically.
========================================================= */

type PersonSuggestion = { personId: string; displayName: string; linkedCompanies: number }

function PrimaryContactField({ error }: { error?: string | null }) {
  const [name, setName] = useState("")
  const [suggestions, setSuggestions] = useState<PersonSuggestion[]>([])
  const [chosen, setChosen] = useState<PersonSuggestion | null>(null)

  useEffect(() => {
    setSuggestions([])
    const typed = name.trim()
    if (chosen || typed.length < 3) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/people/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: typed }),
          signal: controller.signal,
        })
        if (!response.ok) return
        const body = await response.json().catch(() => null)
        if (Array.isArray(body?.matches)) setSuggestions(body.matches as PersonSuggestion[])
      } catch {
        // The lookup is a convenience; without it a new person is simply created.
      }
    }, 400)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [name, chosen])

  return (
    <Field label="Primary Contact" htmlFor="contactPerson" error={error} className="sm:col-span-2">
      {chosen ? (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
          <span className="min-w-0 truncate">
            {chosen.displayName} <span className="text-xs text-muted-foreground">(existing person)</span>
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setChosen(null)}>
            Change
          </Button>
          <input type="hidden" name="contactPersonId" value={chosen.personId} />
        </div>
      ) : (
        <Input id="contactPerson" name="contactPerson" value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" autoComplete="off" maxLength={200} />
      )}
      {!chosen && suggestions.length > 0 && (
        <ul className="space-y-1 rounded-md border bg-muted/20 p-2 text-xs" aria-label="People already on record">
          {suggestions.map((person) => (
            <li key={person.personId} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {person.displayName}
                <span className="text-muted-foreground">
                  {" "}
                  · on record{person.linkedCompanies > 0 ? `, linked to ${person.linkedCompanies} company record${person.linkedCompanies === 1 ? "" : "s"}` : ""}
                </span>
              </span>
              <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => setChosen(person)}>
                Use this person
              </Button>
            </li>
          ))}
          <li className="text-muted-foreground">Not the same person? Keep typing: a new person is created.</li>
        </ul>
      )}
    </Field>
  )
}

/* =========================================================
   ADDRESS BLOCK
========================================================= */

function SmartAddressBlock({
  title,
  prefix,
  errorFor,
}: {
  title: string
  prefix: string
  errorFor: (name: string) => string | null
}) {
  const [country, setCountry] = useState("")
  const [region, setRegion] = useState("")

  const handleRegionChange = (value: string) => {
    setRegion(value)
    setCountry(REGIONS.find((item) => item.code === value)?.country || "")
  }

  return (
    <div className="space-y-3 border-t border-border/70 pt-4 first:border-t-0 first:pt-0">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary/80">
        <span className="size-1.5 rounded-full bg-primary/60" aria-hidden="true" />
        {title}
      </h3>
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Street" htmlFor={`${prefix}_street`} className="lg:col-span-2" error={errorFor(`${prefix}_street`)}>
          <Input id={`${prefix}_street`} name={`${prefix}_street`} />
        </Field>
        <Field label="City" htmlFor={`${prefix}_city`} error={errorFor(`${prefix}_city`)}>
          <Input id={`${prefix}_city`} name={`${prefix}_city`} />
        </Field>
        <Field label="Province / State" error={errorFor(`${prefix}_state`)}>
          <input type="hidden" name={`${prefix}_state`} value={region} />
          <Select
            value={region}
            onValueChange={(value) => {
              if (value) handleRegionChange(value)
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {REGIONS.map((item) => (
                <SelectItem key={`${item.country}-${item.code}`} value={item.code}>
                  {item.name} ({item.code}) · {item.country}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Postal / ZIP" htmlFor={`${prefix}_zip`}>
          <Input id={`${prefix}_zip`} name={`${prefix}_zip`} />
        </Field>
        <Field label="Country" htmlFor={`${prefix}_country`}>
          <Input id={`${prefix}_country`} name={`${prefix}_country`} value={country} readOnly placeholder="From province / state" className="bg-muted/50" />
        </Field>
      </div>
    </div>
  )
}

/* =========================================================
   DUPLICATE FINDINGS (shown only when there is something to review)
========================================================= */

function DuplicateStatusPanel({
  blocking,
  review,
  reviewAcknowledged,
  onReviewAcknowledged,
}: {
  blocking: DuplicateFinding[]
  review: DuplicateFinding[]
  reviewAcknowledged: boolean
  onReviewAcknowledged: (checked: boolean) => void
}) {
  if (!blocking.length && !review.length) return null

  return (
    <div className="space-y-2">
      {blocking.length > 0 && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-semibold text-destructive">An identifier already belongs to another company</p>
              {blocking.map((finding) => (
                <div key={finding.id} className="rounded-md border border-destructive/15 bg-background p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-destructive/30 text-destructive">
                      BLOCK
                    </Badge>
                    <span className="font-semibold">{finding.label}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{finding.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {review.length > 0 && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50/50 p-3 dark:bg-amber-950/10">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-semibold">Possible match with an existing record</p>
              {review.map((finding) => (
                <div key={finding.id} className="rounded-md border bg-background p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-amber-300 text-amber-700">
                      REVIEW
                    </Badge>
                    <span className="font-semibold">{finding.label}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{finding.message}</p>
                </div>
              ))}
              {blocking.length === 0 && (
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <Checkbox checked={reviewAcknowledged} onCheckedChange={(checked) => onReviewAcknowledged(checked === true)} />
                  <span>I reviewed these matches; this is a separate company.</span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* =========================================================
   PAGE
========================================================= */

export default function NewCompanyPage() {
  const router = useRouter()

  const [credentialsContext, setCredentialsContext] = useState(false)
  const [contextReady, setContextReady] = useState(false)
  const [selectedType, setSelectedType] = useState("")
  const [companyName, setCompanyName] = useState("")

  /* company.region continues to be populated from this exact state. */
  const [opRegion, setOpRegion] = useState("Canada Only")

  /* regCorpState / regCorpCountry are preserved exactly. */
  const [businessRegion, setBusinessRegion] = useState("")
  const [businessCountry, setBusinessCountry] = useState("")

  const [businessNumber, setBusinessNumber] = useState("")
  const [einNumber, setEinNumber] = useState("")
  const [gstHst, setGstHst] = useState("")
  const [gstHstError, setGstHstError] = useState<string | null>(null)

  const [selectedCargo, setSelectedCargo] = useState<string[]>([])
  const [submitIssues, setSubmitIssues] = useState<Array<{ field: string; message: string }>>([])

  const [blockingFindings, setBlockingFindings] = useState<DuplicateFinding[]>([])
  const [reviewFindings, setReviewFindings] = useState<DuplicateFinding[]>([])
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromCredentials = params.get("context") === "credentials"
    setCredentialsContext(fromCredentials)

    if (fromCredentials) {
      const initialName = params.get("name")?.trim()
      if (initialName) setCompanyName(initialName)
    }

    setContextReady(true)
  }, [])

  const isCustomer = selectedType === "Customer"
  const isCanada = opRegion === "Canada Only" || opRegion === "Cross-Border"
  const isUS = opRegion === "US Only" || opRegion === "Cross-Border"
  const showCustoms = opRegion === "Cross-Border"

  const errorFor = (name: string): string | null => submitIssues.find((issue) => issue.field === name)?.message ?? null

  const handleBusinessRegionChange = (value: string) => {
    setBusinessRegion(value)
    setBusinessCountry(REGIONS.find((item) => item.code === value)?.country || "")
  }

  const handleBusinessNumberChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setBusinessNumber(event.target.value.replace(/\D/g, "").slice(0, 9))
  }

  const handleEinChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, "").slice(0, 9)
    setEinNumber(digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits)
  }

  const checkGstHst = (value: string) => {
    const typed = value.trim()
    if (!typed) return setGstHstError(null)
    if (!GST_HST_PATTERN.test(typed)) return setGstHstError("Use nine digits, RT and four digits, e.g. 123456789 RT 0001.")
    const bn = businessNumber.replace(/\D/g, "")
    if (bn.length === 9 && !typed.replace(/\D/g, "").startsWith(bn)) return setGstHstError("The account must begin with the Business Number.")
    setGstHstError(null)
  }

  const runDuplicateCheck = (form: HTMLFormElement) => {
    const result = evaluateDuplicates(form)
    setBlockingFindings(result.blocking)
    setReviewFindings(result.review)
    return result
  }

  const handleFormChange = (event: React.FormEvent<HTMLFormElement>) => {
    const result = runDuplicateCheck(event.currentTarget)
    if (result.review.length > 0) setReviewAcknowledged(false)
  }

  const canSubmit = useMemo(() => {
    if (!selectedType) return false
    if (!companyName.trim()) return false
    if (!opRegion) return false
    if (CARGO_STORAGE_AVAILABLE && isCustomer && selectedCargo.length === 0) return false
    if (gstHstError) return false
    if (blockingFindings.length > 0) return false
    if (reviewFindings.length > 0 && !reviewAcknowledged) return false
    return true
  }, [selectedType, companyName, opRegion, isCustomer, selectedCargo, gstHstError, blockingFindings, reviewFindings, reviewAcknowledged])

  const handleCreateCompany = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = event.currentTarget
    const duplicateResult = runDuplicateCheck(form)
    if (duplicateResult.blocking.length > 0) return
    if (duplicateResult.review.length > 0 && !reviewAcknowledged) return

    if (!selectedType) {
      setSubmitIssues([{ field: "companyType", message: "Select a record type." }])
      return
    }
    if (!companyName.trim()) {
      setSubmitIssues([{ field: "companyName", message: "Company Name is required." }])
      return
    }
    if (CARGO_STORAGE_AVAILABLE && isCustomer && selectedCargo.length === 0) {
      setSubmitIssues([{ field: "cargoTypes", message: "Cargo Information is mandatory for a Customer record." }])
      return
    }
    if (isCustomer && !String(new FormData(form).get("startDate") || "").trim()) {
      setSubmitIssues([{ field: "startDate", message: "Service Start Date is required for a Customer." }])
      return
    }

    setSubmitting(true)
    setSubmitIssues([])

    try {
      const formData = new FormData(form)
      // An existing person is chosen by id; the typed name is then only a search term.
      if (String(formData.get("contactPersonId") || "")) formData.delete("contactPerson")
      const formEntries = Object.fromEntries(formData.entries())

      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formEntries,
          companyName: companyName.trim(),
          companyType: selectedType,
          opRegion,
          regCorpState: businessRegion,
          regCorpCountry: businessCountry,
          // The Canadian Business Number and the US EIN are separate identifiers; neither is ever copied into the other.
          businessNo: isCanada ? businessNumber : "",
          ein: isUS ? einNumber : "",
          gstHst: isCanada ? gstHst.trim() : "",
        }),
      })

      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        setSubmitIssues(
          Array.isArray(result.issues) && result.issues.length > 0
            ? result.issues
            : [{ field: "", message: result.error || "Unable to create company." }]
        )
        setSubmitting(false)
        return
      }

      const newCompany = result.company

      if (credentialsContext && window.parent !== window) {
        window.parent.postMessage(
          {
            type: "TES_CREDENTIALS_COMPANY_CREATED",
            company: {
              id: newCompany.id,
              name: newCompany.name,
              companyName: newCompany.name,
              kind: newCompany.kind,
              region: newCompany.region,
              status: newCompany.status,
            },
          },
          window.location.origin
        )
        return
      }

      router.push(`/companies/${newCompany.id}/profile`)
    } catch (error) {
      console.error("Unable to create company:", error)
      setSubmitIssues([{ field: "", message: "The company could not be created and nothing was saved. Check your connection and try again." }])
      setSubmitting(false)
    }
  }

  if (!contextReady) {
    return <div className="min-h-screen bg-background" />
  }

  const knownFields = new Set(["companyName", "companyType", "startDate", "cargoTypes", "website", "gstHst", "contactPerson", "contactPersonId", "email", "billingEmail", "phone"])
  const otherIssues = submitIssues.filter((issue) => !knownFields.has(issue.field) && !/^(reg|mail|yard)_/.test(issue.field))

  return (
    <div className="flex flex-col gap-4 pb-10">
      <PageHeader
        title="Add Company"
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 size-4" />
            Cancel
          </Button>
        }
      />

      <form onSubmit={handleCreateCompany} onChange={handleFormChange} className="flex max-w-6xl flex-col gap-5" noValidate>
        {/* ---------------------------------------------------- COMPANY */}
        <Section title="Company" icon={Building2} accent>
          <Field label="Record Type" required error={errorFor("companyType")}>
            <input type="hidden" name="companyType" value={selectedType} />
            <Select value={selectedType} onValueChange={(value) => setSelectedType(value ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {(credentialsContext ? COMPANY_TYPES.filter((type) => type !== "Customer" && type !== "Prospect") : COMPANY_TYPES).map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Company Name" htmlFor="companyName" required className="sm:col-span-2" error={errorFor("companyName")}>
            <Input id="companyName" name="companyName" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required />
          </Field>

          <Field label="DBA" htmlFor="dba">
            <Input id="dba" name="dba" />
          </Field>

          <Field label="Operating Region" required hint="Decides which jurisdiction-specific TES modules apply.">
            <input type="hidden" name="opRegion" value={opRegion} />
            <Select value={opRegion} onValueChange={(value) => setOpRegion(value ?? "Canada Only")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Canada Only">Canada Only</SelectItem>
                <SelectItem value="US Only">US Only</SelectItem>
                <SelectItem value="Cross-Border">Cross-Border</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Registered Province / State" error={errorFor("regCorpState")}>
            <input type="hidden" name="regCorpState" value={businessRegion} />
            <Select
              value={businessRegion}
              onValueChange={(value) => {
                if (value) handleBusinessRegionChange(value)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((region) => (
                  <SelectItem key={`${region.country}-${region.code}`} value={region.code}>
                    {region.name} ({region.code}) · {region.country}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Registered Country" htmlFor="regCorpCountry">
            <Input id="regCorpCountry" name="regCorpCountry" value={businessCountry} readOnly placeholder="From province / state" className="bg-muted/50" />
          </Field>

          <Field label="Incorporation No." htmlFor="incorpNo" error={errorFor("incorpNo")}>
            <Input id="incorpNo" name="incorpNo" />
          </Field>

          {isCanada && (
            <Field label="Business Number (BN)" htmlFor="businessNo" error={errorFor("businessNo")}>
              <Input id="businessNo" value={businessNumber} onChange={handleBusinessNumberChange} placeholder="9 digits" inputMode="numeric" maxLength={9} />
              <input type="hidden" name="businessNo" value={businessNumber} />
            </Field>
          )}

          {isCanada && (
            <Field label="GST/HST Account" htmlFor="gstHst" error={gstHstError ?? errorFor("gstHst")}>
              <Input
                id="gstHst"
                name="gstHst"
                value={gstHst}
                onChange={(event) => {
                  setGstHst(event.target.value)
                  if (gstHstError) checkGstHst(event.target.value)
                }}
                onBlur={(event) => checkGstHst(event.target.value)}
                placeholder="123456789 RT 0001"
                maxLength={40}
                autoComplete="off"
              />
            </Field>
          )}

          {isUS && (
            <Field label="EIN" htmlFor="ein" error={errorFor("ein")}>
              <Input id="ein" name="ein" value={einNumber} onChange={handleEinChange} placeholder="12-3456789" inputMode="numeric" maxLength={10} />
            </Field>
          )}
        </Section>

        {/* ---------------------------------------------------- CONTACT */}
        <Section title="Contact" icon={UserRound}>
          <PrimaryContactField error={errorFor("contactPerson") ?? errorFor("contactPersonId")} />

          <Field label="Phone" htmlFor="phone" error={errorFor("phone")}>
            <Input id="phone" name="phone" type="tel" placeholder="+1 555 000 0000" />
          </Field>

          <Field label="Website" htmlFor="website" error={errorFor("website")}>
            <Input id="website" name="website" type="url" placeholder="https://" maxLength={254} />
          </Field>

          <Field label="Account Email" htmlFor="email" error={errorFor("email")}>
            <Input id="email" name="email" type="email" />
          </Field>

          <Field label="Billing Email" htmlFor="billingEmail" error={errorFor("billingEmail")}>
            <Input id="billingEmail" name="billingEmail" type="email" />
          </Field>
        </Section>

        {/* ---------------------------------------------------- CUSTOMER */}
        {isCustomer && (
          <>
            <Section title="Service" icon={Truck}>
              <Field
                label="Service Start Date"
                htmlFor="startDate"
                required
                hint="The date TES began providing services to this customer."
                error={errorFor("startDate")}
              >
                <Input id="startDate" name="startDate" type="date" required />
              </Field>

              <Field label="Payment Method" error={errorFor("payMethod")}>
                <Select name="payMethod">
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Not specified" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="E-Transfer">E-Transfer</SelectItem>
                    <SelectItem value="Credit Card">Credit Card</SelectItem>
                    <SelectItem value="Wire Transfer">Wire Transfer</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Cargo Types" required error={errorFor("cargoTypes")} className="sm:col-span-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={`h-auto min-h-9 w-full justify-between px-3 py-1.5 ${selectedCargo.length === 0 ? "text-muted-foreground" : ""}`}
                    >
                      <div className="flex flex-wrap gap-1 text-left">
                        {selectedCargo.length === 0 && "Select"}
                        {selectedCargo.map((cargo) => (
                          <Badge variant="secondary" key={cargo} className="text-[10px] font-normal">
                            {cargo}
                          </Badge>
                        ))}
                      </div>
                      <ChevronDown className="size-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] p-2" align="start">
                    <div className="space-y-1">
                      {CARGO_OPTIONS.map((option) => (
                        <label key={option} className="flex w-full cursor-pointer items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-muted/50">
                          <Checkbox
                            checked={selectedCargo.includes(option)}
                            onCheckedChange={(nextChecked) =>
                              setSelectedCargo((current) =>
                                nextChecked === true
                                  ? current.includes(option)
                                    ? current
                                    : [...current, option]
                                  : current.filter((item) => item !== option)
                              )
                            }
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <input type="hidden" name="cargoTypes" value={JSON.stringify(selectedCargo)} />
              </Field>

              <Field label="ELD Provider" htmlFor="eldProvider" error={errorFor("eldProvider")}>
                <Input id="eldProvider" name="eldProvider" maxLength={120} />
              </Field>

              <Field label="GPS Provider" htmlFor="gpsProvider" error={errorFor("gpsProvider")}>
                <Input id="gpsProvider" name="gpsProvider" maxLength={120} />
              </Field>

              <Field label="Fuel Provider" htmlFor="fuelProvider" error={errorFor("fuelProvider")}>
                <Input id="fuelProvider" name="fuelProvider" maxLength={120} />
              </Field>
            </Section>

            <Section title="Carrier & Tax IDs" icon={FileBadge}>
              {isCanada && (
                <>
                  <Field label="MVID / RIN" htmlFor="mvid" error={errorFor("mvid")}>
                    <Input id="mvid" name="mvid" />
                  </Field>
                  <Field label="NSC / CVOR" htmlFor="nsc" error={errorFor("nsc")}>
                    <Input id="nsc" name="nsc" />
                  </Field>
                </>
              )}

              {isUS && (
                <>
                  <Field label="USDOT" htmlFor="usdot" error={errorFor("usdot")}>
                    <Input id="usdot" name="usdot" />
                  </Field>
                  <Field label="MC" htmlFor="mc" error={errorFor("mc")}>
                    <Input id="mc" name="mc" />
                  </Field>
                </>
              )}

              <Field label="IRP Account" htmlFor="accIrp" error={errorFor("accIrp")}>
                <Input id="accIrp" name="accIrp" />
              </Field>
              <Field label="IFTA Account" htmlFor="accIfta" error={errorFor("accIfta")}>
                <Input id="accIfta" name="accIfta" />
              </Field>

              {isUS && (
                <>
                  <Field label="NY HUT" htmlFor="accNyhut">
                    <Input id="accNyhut" name="accNyhut" />
                  </Field>
                  <Field label="NM WDT" htmlFor="accNm">
                    <Input id="accNm" name="accNm" />
                  </Field>
                  <Field label="Kentucky KYU" htmlFor="accKyu">
                    <Input id="accKyu" name="accKyu" />
                  </Field>
                  <Field label="Oregon" htmlFor="accOr">
                    <Input id="accOr" name="accOr" />
                  </Field>
                  <Field label="CT DRS" htmlFor="accCt">
                    <Input id="accCt" name="accCt" />
                  </Field>
                </>
              )}

              {showCustoms && (
                <>
                  <Field label="SCAC" htmlFor="scac">
                    <Input id="scac" name="scac" />
                  </Field>
                  <Field label="Carrier Code" htmlFor="carrierCode">
                    <Input id="carrierCode" name="carrierCode" />
                  </Field>
                </>
              )}
            </Section>
          </>
        )}

        {/* ---------------------------------------------------- ADDRESSES */}
        <Section title="Address" icon={MapPin} grid={false}>
          <SmartAddressBlock title="Registered" prefix="reg" errorFor={errorFor} />
          {isCustomer && (
            <>
              <SmartAddressBlock title="Mailing" prefix="mail" errorFor={errorFor} />
              <SmartAddressBlock title="Yard" prefix="yard" errorFor={errorFor} />
            </>
          )}
        </Section>

        <DuplicateStatusPanel
          blocking={blockingFindings}
          review={reviewFindings}
          reviewAcknowledged={reviewAcknowledged}
          onReviewAcknowledged={setReviewAcknowledged}
        />

        {otherIssues.length > 0 && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-semibold text-destructive">Not saved</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-destructive">
              {otherIssues.map((issue, index) => (
                <li key={`${issue.field}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-md backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="min-w-0 text-sm">
            {blockingFindings.length > 0 ? (
              <span className="flex items-center gap-2 font-medium text-destructive">
                <XCircle className="size-4 shrink-0" />
                Resolve the identifier conflict to save.
              </span>
            ) : submitIssues.length > 0 ? (
              <span className="font-medium text-destructive">Not saved. Fix the marked fields.</span>
            ) : null}
          </div>

          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={submitting}>
              Discard
            </Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              <Save className="mr-2 size-4" />
              {submitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
