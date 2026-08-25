"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronDown,
  Fingerprint,
  Landmark,
  MapPin,
  Save,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
const REGIONS: Region[] = [
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
].sort((a, b) => a.name.localeCompare(b.name))

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

/* =========================================================
   PORTAL RECORD DISCOVERY

   During the localStorage prototype stage, this allows the
   duplicate engine to inspect TES stores rather than only
   tes_companies.

   Production replacement:
   this becomes one server-side identity/uniqueness service.
========================================================= */

function collectObjects(
  value: unknown,
  source: string,
  output: PortalRecord[]
) {
  if (!value || typeof value !== "object") return

  if (Array.isArray(value)) {
    value.forEach((item) => collectObjects(item, source, output))
    return
  }

  const object = value as Record<string, any>

  output.push({
    data: object,
    source,
  })

  Object.values(object).forEach((child) => {
    if (child && typeof child === "object") {
      collectObjects(child, source, output)
    }
  })
}

function getPortalRecords(): PortalRecord[] {
  const records: PortalRecord[] = []

  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)

      if (!key || !key.startsWith("tes_")) continue

      const raw = localStorage.getItem(key)

      if (!raw) continue

      try {
        const parsed = JSON.parse(raw)
        collectObjects(parsed, key, records)
      } catch {
        // Ignore non-JSON prototype storage entries.
      }
    }
  } catch {
    return []
  }

  return records
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
   RECORD ID
========================================================= */

function generateCompanyRecordId(existingIds: Set<string>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    let randomNumber: number

    if (
      typeof crypto !== "undefined" &&
      "getRandomValues" in crypto
    ) {
      const values = new Uint32Array(1)
      crypto.getRandomValues(values)

      randomNumber = 10000 + (values[0] % 90000)
    } else {
      randomNumber =
        10000 + Math.floor(Math.random() * 90000)
    }

    const id = `CMP-${randomNumber}`

    if (!existingIds.has(id)) return id
  }

  return `CMP-${Date.now()}`
}

/* =========================================================
   ADDRESS BLOCK
========================================================= */

function SmartAddressBlock({
  title,
  prefix,
  isAdditional = false,
}: {
  title: string
  prefix: string
  isAdditional?: boolean
}) {
  const [country, setCountry] = useState("")
  const [region, setRegion] = useState("")

  const handleRegionChange = (value: string) => {
    setRegion(value)

    const selected = REGIONS.find(
      (item) => item.code === value
    )

    setCountry(selected?.country || "")
  }

  return (
    <div
      className={`space-y-4 pb-6 last:pb-0 ${
        isAdditional
          ? "rounded-xl border bg-muted/20 p-5"
          : "border-b last:border-0"
      }`}
    >
      <div>
        <h3
          className={`text-sm font-semibold ${
            isAdditional ? "text-primary" : ""
          }`}
        >
          {title}
        </h3>

        {prefix === "reg" && (
          <p className="mt-1 text-xs text-muted-foreground">
            Used for identity comparison and company record verification.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2 lg:col-span-2">
          <Label>Street Address</Label>

          <Input
            name={`${prefix}_street`}
            placeholder="123 Main St"
            className={isAdditional ? "bg-background" : ""}
          />
        </div>

        <div className="space-y-2">
          <Label>City</Label>

          <Input
            name={`${prefix}_city`}
            placeholder="City"
            className={isAdditional ? "bg-background" : ""}
          />
        </div>

        <div className="space-y-2">
          <Label>State / Province</Label>

          <input
            type="hidden"
            name={`${prefix}_state`}
            value={region}
          />

          <Select
            value={region || undefined}
            onValueChange={handleRegionChange}
          >
            <SelectTrigger
              className={isAdditional ? "bg-background" : ""}
            >
              <SelectValue placeholder="Select jurisdiction" />
            </SelectTrigger>

            <SelectContent>
              {REGIONS.map((item) => (
                <SelectItem
                  key={`${item.country}-${item.code}`}
                  value={item.code}
                >
                  {item.name} ({item.code}) · {item.country}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>ZIP / Postal Code</Label>

          <Input
            name={`${prefix}_zip`}
            placeholder="Postal / ZIP Code"
            className={isAdditional ? "bg-background" : ""}
          />
        </div>

        <div className="space-y-2">
          <Label>Country</Label>

          <Input
            name={`${prefix}_country`}
            value={country}
            readOnly
            placeholder="Auto-fills"
            className="bg-muted/50 font-medium text-muted-foreground"
          />
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   DUPLICATE STATUS PANEL
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
  if (!blocking.length && !review.length) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:bg-emerald-950/10">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />

        <div>
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            No duplicate conflict currently detected
          </p>

          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            TES continues checking entered identifiers and identity signals
            as the record is completed.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {blocking.length > 0 && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-destructive">
                Creation blocked — authoritative identifier conflict
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Resolve these matches before creating another company record.
              </p>

              <div className="mt-3 space-y-2">
                {blocking.map((finding) => (
                  <div
                    key={finding.id}
                    className="rounded-lg border border-destructive/15 bg-background p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className="border-destructive/30 text-destructive"
                      >
                        BLOCK
                      </Badge>

                      <span className="text-xs font-semibold">
                        {finding.label}
                      </span>

                      {finding.matchedRecordId && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {finding.matchedRecordId}
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {finding.message}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {review.length > 0 && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50/50 p-4 dark:bg-amber-950/10">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                Potential identity overlap requires review
              </p>

              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                These matches do not automatically mean the records are the
                same. Review the evidence and relationships before proceeding.
              </p>

              <div className="mt-3 space-y-2">
                {review.map((finding) => (
                  <div
                    key={finding.id}
                    className="rounded-lg border bg-background p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className="border-amber-300 text-amber-700"
                      >
                        REVIEW
                      </Badge>

                      <span className="text-xs font-semibold">
                        {finding.label}
                      </span>

                      {finding.matchedRecordId && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {finding.matchedRecordId}
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {finding.message}
                    </p>
                  </div>
                ))}
              </div>

              {blocking.length === 0 && (
                <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border bg-background p-3">
                  <Checkbox
                    checked={reviewAcknowledged}
                    onCheckedChange={(checked) =>
                      onReviewAcknowledged(checked === true)
                    }
                  />

                  <span className="text-xs leading-5">
                    I reviewed the potential matches and confirm this company
                    should be created as a separate company record.
                  </span>
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

  const [recordId, setRecordId] = useState("")
  const [selectedType, setSelectedType] = useState("")
  const [companyName, setCompanyName] = useState("")

  /*
    IMPORTANT CONTRACT:
    company.region continues to be populated from this exact state.
  */
  const [opRegion, setOpRegion] = useState("Canada Only")

  /*
    IMPORTANT CONTRACT:
    regCorpState / regCorpCountry are preserved exactly.
  */
  const [businessRegion, setBusinessRegion] = useState("")
  const [businessCountry, setBusinessCountry] = useState("")

  const [businessNumber, setBusinessNumber] = useState("")
  const [einNumber, setEinNumber] = useState("")

  const [selectedCargo, setSelectedCargo] = useState<string[]>([])

  const [blockingFindings, setBlockingFindings] = useState<
    DuplicateFinding[]
  >([])

  const [reviewFindings, setReviewFindings] = useState<
    DuplicateFinding[]
  >([])

  const [
    reviewAcknowledged,
    setReviewAcknowledged,
  ] = useState(false)

  const [submitting, setSubmitting] = useState(false)

  /* ---------------------------------------------------------
     RECORD ID
  --------------------------------------------------------- */

  useEffect(() => {
    try {
      const companies = JSON.parse(
        localStorage.getItem("tes_companies") || "[]"
      )

      const ids = new Set<string>(
        companies
          .map((company: any) => company.id)
          .filter(Boolean)
      )

      setRecordId(generateCompanyRecordId(ids))
    } catch {
      setRecordId(generateCompanyRecordId(new Set()))
    }
  }, [])

  /* ---------------------------------------------------------
     REGION LOGIC
  --------------------------------------------------------- */

  const isCustomer = selectedType === "Customer"

  const isCanada =
    opRegion === "Canada Only" ||
    opRegion === "Cross-Border"

  const isUS =
    opRegion === "US Only" ||
    opRegion === "Cross-Border"

  const showCustoms = opRegion === "Cross-Border"

  /* ---------------------------------------------------------
     BUSINESS REGISTRATION JURISDICTION
  --------------------------------------------------------- */

  const handleBusinessRegionChange = (value: string) => {
    setBusinessRegion(value)

    const selected = REGIONS.find(
      (item) => item.code === value
    )

    setBusinessCountry(selected?.country || "")
  }

  /* ---------------------------------------------------------
     BN / EIN FORMATTING
  --------------------------------------------------------- */

  const handleBusinessNumberChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const digits = event.target.value
      .replace(/\D/g, "")
      .slice(0, 9)

    setBusinessNumber(digits)
  }

  const handleEinChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const digits = event.target.value
      .replace(/\D/g, "")
      .slice(0, 9)

    const formatted =
      digits.length > 2
        ? `${digits.slice(0, 2)}-${digits.slice(2)}`
        : digits

    setEinNumber(formatted)
  }

  /* ---------------------------------------------------------
     DUPLICATE CHECK
  --------------------------------------------------------- */

  const runDuplicateCheck = (form: HTMLFormElement) => {
    const result = evaluateDuplicates(form)

    setBlockingFindings(result.blocking)
    setReviewFindings(result.review)

    return result
  }

  const handleFormChange = (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    const result = runDuplicateCheck(event.currentTarget)

    if (result.review.length > 0) {
      setReviewAcknowledged(false)
    }
  }

  /* ---------------------------------------------------------
     FORM COMPLETENESS
  --------------------------------------------------------- */

  const canSubmit = useMemo(() => {
    if (!recordId) return false
    if (!selectedType) return false
    if (!companyName.trim()) return false
    if (!opRegion) return false

    if (isCustomer && selectedCargo.length === 0) {
      return false
    }

    if (blockingFindings.length > 0) {
      return false
    }

    if (
      reviewFindings.length > 0 &&
      !reviewAcknowledged
    ) {
      return false
    }

    return true
  }, [
    recordId,
    selectedType,
    companyName,
    opRegion,
    isCustomer,
    selectedCargo,
    blockingFindings,
    reviewFindings,
    reviewAcknowledged,
  ])

  /* ---------------------------------------------------------
     CREATE
  --------------------------------------------------------- */

  const handleCreateCompany = (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    const form = event.currentTarget

    const duplicateResult = runDuplicateCheck(form)

    if (duplicateResult.blocking.length > 0) {
      return
    }

    if (
      duplicateResult.review.length > 0 &&
      !reviewAcknowledged
    ) {
      return
    }

    if (!selectedType) {
      window.alert(
        "Please select a Company Record Type before saving."
      )
      return
    }

    if (!companyName.trim()) {
      window.alert("Company Name is required.")
      return
    }

    if (
      isCustomer &&
      selectedCargo.length === 0
    ) {
      window.alert(
        "Cargo Information is mandatory for a Customer record."
      )
      return
    }

    setSubmitting(true)

    try {
      const formData = new FormData(form)
      const formEntries = Object.fromEntries(
        formData.entries()
      )

      /*
        US-ONLY COMPATIBILITY:

        Existing TES pages currently read businessNo as the
        combined BN/EIN field.

        We preserve that connection while also storing EIN
        explicitly under `ein`.

        Cross-Border:
        businessNo = Canadian BN
        ein        = US EIN
      */
      const compatibleBusinessNumber =
        opRegion === "US Only"
          ? einNumber
          : businessNumber

      const timestamp = new Date().toISOString()

      const newCompany = {
        ...formEntries,

        /* Permanent TES record identity */
        id: recordId,

        /* Existing directory contracts */
        name: companyName.trim(),
        companyName: companyName.trim(),
        kind: selectedType,

        /*
          IMPORTANT:
          Keep BOTH because current portal code contains consumers
          of each. `region` remains the operational source contract.
        */
        region: opRegion,
        opRegion,

        /*
          Existing contact-directory compatibility.
        */
        contact:
          String(formEntries.contactPerson || "").trim() ||
          "N/A",

        status:
          String(formEntries.status || "").trim() ||
          "Active",

        tone: "ok",

        /*
          Preserve exact registration contract.
        */
        regCorpState: businessRegion,
        regCorpCountry: businessCountry,

        /*
          Preserve current company schema.
        */
        businessNo: compatibleBusinessNumber,

        /*
          Explicit EIN adds precision while keeping old readers working.
        */
        ein: einNumber,

        cargoTypes: selectedCargo,

        /*
          Lifecycle / traceability metadata.
        */
        schemaVersion: 2,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,

        /*
          Preserve human duplicate-review evidence.
          This is NOT the immutable Master Register; it is useful
          prototype metadata until the server-side audit layer is wired.
        */
        duplicateReview:
          duplicateResult.review.length > 0
            ? {
                reviewed: true,
                reviewedAt: timestamp,
                findings: duplicateResult.review.map(
                  (finding) => ({
                    field: finding.field,
                    label: finding.label,
                    matchedRecordId:
                      finding.matchedRecordId || null,
                    matchedRecordName:
                      finding.matchedRecordName || null,
                  })
                ),
              }
            : null,
      }

      const existingCompanies = JSON.parse(
        localStorage.getItem("tes_companies") || "[]"
      )

      /*
        FINAL COLLISION CHECK immediately before writing.

        This protects against a second browser action occurring after
        the first generated record ID.
      */
      if (
        existingCompanies.some(
          (company: any) => company.id === recordId
        )
      ) {
        const replacementId =
          generateCompanyRecordId(
            new Set(
              existingCompanies
                .map((company: any) => company.id)
                .filter(Boolean)
            )
          )

        newCompany.id = replacementId
      }

      localStorage.setItem(
        "tes_companies",
        JSON.stringify([
          newCompany,
          ...existingCompanies,
        ])
      )

      /*
        Compatibility mirror.

        We preserve tes_customers because current portal pages still
        consume it. Later this should become a derived relationship,
        not a second authoritative copy of the company.
      */
      if (selectedType === "Customer") {
        const existingCustomers = JSON.parse(
          localStorage.getItem("tes_customers") || "[]"
        )

        localStorage.setItem(
          "tes_customers",
          JSON.stringify([
            newCompany,
            ...existingCustomers.filter(
              (customer: any) =>
                customer.id !== newCompany.id
            ),
          ])
        )
      }

      router.push(
        `/companies/${newCompany.id}/profile`
      )
    } catch (error) {
      console.error(
        "Unable to create company:",
        error
      )

      window.alert(
        "The company record could not be created. No record was intentionally removed."
      )

      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* =====================================================
          HEADER
      ===================================================== */}

      <PageHeader
        title="Create Entity Record"
        description="Establish the company identity that will connect records across the TES portal."
        actions={
          <Button
            variant="outline"
            onClick={() => router.back()}
          >
            <ArrowLeft className="mr-2 size-4" />
            Cancel
          </Button>
        }
      />

      <form
        onSubmit={handleCreateCompany}
        onChange={handleFormChange}
        className="flex max-w-6xl flex-col gap-7"
      >
        {/* ===================================================
            SECTION 1 — MASTER IDENTITY
        =================================================== */}

        <Card className="overflow-hidden border-primary/25 shadow-sm">
          <div className="h-1 bg-primary/70" />

          <CardHeader className="border-b bg-primary/[0.035]">
            <CardTitle className="flex items-center gap-2">
              <Fingerprint className="size-5 text-primary" />
              Entity Identity
            </CardTitle>

            <CardDescription>
              Establish the permanent TES record identity and relationship type.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid gap-6 pt-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>System Record ID</Label>

              <Input
                value={recordId}
                disabled
                className="bg-muted font-mono"
              />

              <p className="text-[11px] text-muted-foreground">
                Permanent internal company identifier.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="font-medium text-primary">
                Company Record Type *
              </Label>

              <input
                type="hidden"
                name="companyType"
                value={selectedType}
              />

              <Select
                value={selectedType || undefined}
                onValueChange={setSelectedType}
              >
                <SelectTrigger className="border-primary/30">
                  <SelectValue placeholder="Select entity type..." />
                </SelectTrigger>

                <SelectContent>
                  {COMPANY_TYPES.map((type) => (
                    <SelectItem
                      key={type}
                      value={type}
                    >
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* ===================================================
            SECTION 2 — CORE INFORMATION
        =================================================== */}

        <Card>
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Building2 className="size-4 text-primary" />
              Core Information
            </CardTitle>

            <CardDescription className="text-xs">
              Primary identity and communication details.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid gap-5 pt-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="companyName">
                Company Name *
              </Label>

              <Input
                id="companyName"
                name="companyName"
                placeholder="e.g. Power Way Logistics Inc"
                value={companyName}
                onChange={(event) =>
                  setCompanyName(event.target.value)
                }
                required
              />

              <p className="text-[11px] text-muted-foreground">
                Similar names trigger review but never automatically establish
                identity.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dba">DBA</Label>

              <Input
                id="dba"
                name="dba"
                placeholder="Doing Business As"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactPerson">
                Primary Contact
              </Label>

              <Input
                id="contactPerson"
                name="contactPerson"
                placeholder="Full Name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">
                Phone
              </Label>

              <Input
                id="phone"
                name="phone"
                type="tel"
                placeholder="+1 (555) 000-0000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">
                Website
              </Label>

              <Input
                id="website"
                name="website"
                type="url"
                placeholder="https://"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">
                Account Email
              </Label>

              <Input
                id="email"
                name="email"
                type="email"
                placeholder="contact@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billingEmail">
                Billing Email
              </Label>

              <Input
                id="billingEmail"
                name="billingEmail"
                type="email"
                placeholder="billing@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label className="font-medium text-primary">
                Operating Region *
              </Label>

              {/*
                CRITICAL CONTRACT:
                Do not rename/remove this field casually.
              */}
              <input
                type="hidden"
                name="opRegion"
                value={opRegion}
              />

              <Select
                value={opRegion}
                onValueChange={setOpRegion}
              >
                <SelectTrigger className="border-primary/30">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="Canada Only">
                    Canada Only
                  </SelectItem>

                  <SelectItem value="US Only">
                    US Only
                  </SelectItem>

                  <SelectItem value="Cross-Border">
                    Cross-Border
                  </SelectItem>
                </SelectContent>
              </Select>

              <p className="text-[11px] text-muted-foreground">
                Drives jurisdiction-dependent TES modules.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ===================================================
            SECTION 3 — REGISTRATION IDENTITY
        =================================================== */}

        <Card>
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Landmark className="size-4 text-primary" />
              Business Registration
            </CardTitle>

            <CardDescription className="text-xs">
              Legal registration and jurisdiction identifiers for the entity.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid gap-5 pt-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>
                Registered Province / State
              </Label>

              {/*
                CRITICAL CONTRACT:
                regCorpState is already consumed by other TES pages.
              */}
              <input
                type="hidden"
                name="regCorpState"
                value={businessRegion}
              />

              <Select
                value={businessRegion || undefined}
                onValueChange={handleBusinessRegionChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select jurisdiction" />
                </SelectTrigger>

                <SelectContent>
                  {REGIONS.map((region) => (
                    <SelectItem
                      key={`${region.country}-${region.code}`}
                      value={region.code}
                    >
                      {region.name} ({region.code}) · {region.country}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Registered Country</Label>

              {/*
                CRITICAL CONTRACT:
                regCorpCountry is already consumed by other TES pages.
              */}
              <Input
                name="regCorpCountry"
                value={businessCountry}
                readOnly
                placeholder="Auto-fills"
                className="bg-muted/50 font-medium text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label>
                Incorporation / Charter Number
              </Label>

              <Input
                name="incorpNo"
                placeholder={
                  businessCountry === "Canada"
                    ? "e.g. 1234567-8"
                    : businessCountry === "United States"
                    ? "State file / charter number"
                    : "Registration number"
                }
              />
            </div>

            {isCanada && (
              <div className="space-y-2">
                <Label>
                  CRA Business Number (BN)
                </Label>

                <Input
                  value={businessNumber}
                  onChange={handleBusinessNumberChange}
                  placeholder="123456789"
                  inputMode="numeric"
                  maxLength={9}
                />

                {/*
                  businessNo remains the canonical existing field.
                */}
                <input
                  type="hidden"
                  name="businessNo"
                  value={businessNumber}
                />
              </div>
            )}

            {isUS && (
              <div className="space-y-2">
                <Label>
                  IRS Employer Identification Number (EIN)
                </Label>

                <Input
                  name="ein"
                  value={einNumber}
                  onChange={handleEinChange}
                  placeholder="12-3456789"
                  inputMode="numeric"
                  maxLength={10}
                />

                {/*
                  US-only compatibility with current TES consumers
                  that still read businessNo as BN/EIN.
                */}
                {opRegion === "US Only" && (
                  <input
                    type="hidden"
                    name="businessNo"
                    value={einNumber}
                  />
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>
                {businessCountry === "Canada"
                  ? "GST / HST Program Account"
                  : businessCountry === "United States"
                  ? "State Tax Registration #"
                  : "Tax Registration #"}
              </Label>

              <Input
                name="gstHst"
                placeholder={
                  businessCountry === "Canada"
                    ? "123456789 RT 0001"
                    : "Tax registration number"
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* ===================================================
            CUSTOMER PROFILE
        =================================================== */}

        {isCustomer && (
          <div className="relative flex flex-col gap-6 rounded-xl border-2 border-dashed bg-muted/15 p-6">
            <div className="absolute -top-3 left-6 flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm font-semibold text-primary shadow-sm">
              <CheckCircle2 className="size-3.5" />
              Compliance & Services Profile
            </div>

            {/* CUSTOMER RELATIONSHIP */}
            <Card className="shadow-none">
              <CardHeader className="border-b bg-muted/10">
                <CardTitle className="text-sm">
                  Customer Information
                </CardTitle>
              </CardHeader>

              <CardContent className="grid gap-5 pt-6 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label>Service Type</Label>

                  <Select
                    name="svcType"
                    defaultValue="Premium"
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="Premium">
                        Premium
                      </SelectItem>

                      <SelectItem value="Standard">
                        Standard
                      </SelectItem>

                      <SelectItem value="Basic">
                        Basic
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Service Status</Label>

                  <Select
                    name="status"
                    defaultValue="Active"
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="Active">
                        Active
                      </SelectItem>

                      <SelectItem value="Pending">
                        Pending
                      </SelectItem>

                      <SelectItem value="Inactive">
                        Inactive
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Start Date</Label>

                  <Input
                    name="startDate"
                    type="date"
                  />
                </div>

                <div className="space-y-2">
                  <Label>End Date</Label>

                  <Input
                    name="endDate"
                    type="date"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Payment Method</Label>

                  <Select
                    name="payMethod"
                    defaultValue="E-Transfer"
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="E-Transfer">
                        E-Transfer
                      </SelectItem>

                      <SelectItem value="Credit Card">
                        Credit Card
                      </SelectItem>

                      <SelectItem value="Wire Transfer">
                        Wire Transfer
                      </SelectItem>

                      <SelectItem value="Cheque">
                        Cheque
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col space-y-2">
                  <Label>
                    Cargo Information *
                  </Label>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className={`h-auto min-h-10 w-full justify-between px-3 py-2 ${
                          selectedCargo.length === 0
                            ? "text-muted-foreground"
                            : ""
                        }`}
                      >
                        <div className="flex flex-wrap gap-1 text-left">
                          {selectedCargo.length === 0 &&
                            "Select cargo types..."}

                          {selectedCargo.map((cargo) => (
                            <Badge
                              variant="secondary"
                              key={cargo}
                              className="text-[10px] font-normal"
                            >
                              {cargo}
                            </Badge>
                          ))}
                        </div>

                        <ChevronDown className="size-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>

                    <PopoverContent
                      className="w-[320px] p-2"
                      align="start"
                    >
                      <p className="mb-2 px-1 text-xs font-semibold text-muted-foreground">
                        Select all that apply
                      </p>

                      <div className="space-y-1">
                        {CARGO_OPTIONS.map((option) => {
                          const checked =
                            selectedCargo.includes(option)

                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() =>
                                setSelectedCargo((current) =>
                                  checked
                                    ? current.filter(
                                        (item) =>
                                          item !== option
                                      )
                                    : [...current, option]
                                )
                              }
                              className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={checked}
                              />

                              <span>{option}</span>
                            </button>
                          )
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <input
                    type="hidden"
                    name="cargoTypes"
                    value={JSON.stringify(selectedCargo)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* CARRIER INFORMATION */}
            <Card className="shadow-none">
              <CardHeader className="border-b bg-muted/10">
                <CardTitle className="text-sm">
                  Carrier Information
                </CardTitle>
              </CardHeader>

              <CardContent className="grid gap-5 pt-6 sm:grid-cols-2 lg:grid-cols-4">
                {isCanada && (
                  <>
                    <div className="space-y-2">
                      <Label>MVID / RIN #</Label>
                      <Input name="mvid" />
                    </div>

                    <div className="space-y-2">
                      <Label>NSC / CVOR #</Label>
                      <Input name="nsc" />
                    </div>
                  </>
                )}

                {isUS && (
                  <>
                    <div className="space-y-2">
                      <Label>USDOT #</Label>
                      <Input name="usdot" />
                    </div>

                    <div className="space-y-2">
                      <Label>MC #</Label>
                      <Input name="mc" />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* TAX ACCOUNTS */}
            <Card className="shadow-none">
              <CardHeader className="border-b bg-muted/10">
                <CardTitle className="text-sm">
                  Tax & Compliance Accounts
                </CardTitle>

                <CardDescription className="text-xs">
                  Account identifiers are treated as strong duplicate signals.
                </CardDescription>
              </CardHeader>

              <CardContent className="grid gap-5 pt-6 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label>IRP Account #</Label>
                  <Input name="accIrp" />
                </div>

                <div className="space-y-2">
                  <Label>IFTA Account #</Label>
                  <Input name="accIfta" />
                </div>

                {isUS && (
                  <>
                    <div className="space-y-2">
                      <Label>NY HUT Account #</Label>
                      <Input name="accNyhut" />
                    </div>

                    <div className="space-y-2">
                      <Label>NM WDT Account #</Label>
                      <Input name="accNm" />
                    </div>

                    <div className="space-y-2">
                      <Label>Kentucky KYU #</Label>
                      <Input name="accKyu" />
                    </div>

                    <div className="space-y-2">
                      <Label>Oregon Account #</Label>
                      <Input name="accOr" />
                    </div>

                    <div className="space-y-2">
                      <Label>CT DRS Account #</Label>
                      <Input name="accCt" />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* CUSTOMS + FLEET */}
            <div className="grid gap-6 lg:grid-cols-2">
              {showCustoms && (
                <Card className="shadow-none">
                  <CardHeader className="border-b bg-muted/10">
                    <CardTitle className="text-sm">
                      Customs Information
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>SCAC</Label>
                      <Input name="scac" />
                    </div>

                    <div className="space-y-2">
                      <Label>Carrier Code</Label>
                      <Input name="carrierCode" />
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card
                className={`shadow-none ${
                  !showCustoms ? "lg:col-span-2" : ""
                }`}
              >
                <CardHeader className="border-b bg-muted/10">
                  <CardTitle className="text-sm">
                    Fleet Information
                  </CardTitle>
                </CardHeader>

                <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Truck GPS Provider</Label>
                    <Input name="gpsProvider" />
                  </div>

                  <div className="space-y-2">
                    <Label>Fuel Provider</Label>
                    <Input name="fuelProvider" />
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <Label>Assessment Date</Label>
                    <Input
                      name="assessmentDate"
                      type="date"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ===================================================
            SECTION 4 — ADDRESSES
        =================================================== */}

        <Card>
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MapPin className="size-4 text-primary" />
              Address Information
            </CardTitle>

            <CardDescription className="text-xs">
              Address information participates in duplicate and relationship
              review but does not independently prove identity.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 pt-6">
            <SmartAddressBlock
              title="Registered Address"
              prefix="reg"
            />

            {isCustomer && (
              <>
                <SmartAddressBlock
                  title="Mailing Address"
                  prefix="mail"
                  isAdditional
                />

                <SmartAddressBlock
                  title="Yard Address"
                  prefix="yard"
                  isAdditional
                />
              </>
            )}
          </CardContent>
        </Card>

        {/* ===================================================
            DUPLICATE / IDENTITY CONTROL
        =================================================== */}

        <Card className="border-primary/15">
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-primary" />
              Identity & Duplicate Control
            </CardTitle>

            <CardDescription className="text-xs">
              TES checks strong identifiers separately from weaker identity
              signals such as names, contacts and addresses.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <DuplicateStatusPanel
              blocking={blockingFindings}
              review={reviewFindings}
              reviewAcknowledged={reviewAcknowledged}
              onReviewAcknowledged={
                setReviewAcknowledged
              }
            />
          </CardContent>
        </Card>

        {/* ===================================================
            SAVE
        =================================================== */}

        <div className="sticky bottom-4 z-10 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              {blockingFindings.length > 0 ? (
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <XCircle className="size-4 shrink-0" />
                  Resolve duplicate identifier conflicts before saving.
                </div>
              ) : reviewFindings.length > 0 &&
                !reviewAcknowledged ? (
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                  <AlertTriangle className="size-4 shrink-0" />
                  Review and acknowledge potential duplicate matches.
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                  Record is ready when required information is complete.
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={submitting}
              >
                Discard
              </Button>

              <Button
                type="submit"
                disabled={!canSubmit || submitting}
              >
                <Save className="mr-2 size-4" />

                {submitting
                  ? "Creating..."
                  : "Create Record"}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
