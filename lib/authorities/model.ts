import { DEFAULT_DEADLINE_RULES } from "@/lib/deadline-engine"
import { JURISDICTIONS, resolveCountryForJurisdiction, getJurisdictionLabel } from "@/lib/jurisdictions"
import type { Company, DeadlineRules, AuthorityRecord, SafetyRecord, AuditRecord, AuthorityType, AuthorityCategory, AuthorityDraft, SafetySystem, SafetyDraft, AuditDraft, StoredAuthoritiesData } from "./types"

const SYSTEM_SETTINGS_KEY = "tes_system_settings"
const THREE_YEAR_HISTORY = 3

export const EMPTY_DATA: StoredAuthoritiesData = {
  version: 3,
  authorities: [],
  safety: [],
  audits: [],
  evidence: [],
}

/* =========================================================
   HELPERS & REPOSITORY UTILITIES
========================================================= */

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

export function isoNow() {
  return new Date().toISOString()
}

export function todayISO() {
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

export function getCompanies(): Company[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function loadDeadlineRules(): DeadlineRules {
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

export function readFileAsDataUrl(file: File): Promise<string> {
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

export function captureCrossStoreSnapshot(companyId: string): CrossStoreSnapshot {
  return {
    companies: localStorage.getItem("tes_companies"),
    authorities: localStorage.getItem(`tes_company_authorities_${companyId}`),
  }
}

export function rollbackCrossStoreSnapshot(companyId: string, snapshot: CrossStoreSnapshot) {
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

export function deriveAuthorityProfile(company: Company): AuthorityProfile {
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

export function isDateInsideThreeYears(dateValue?: string) {
  if (!dateValue) {
    return true
  }
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) {
    return true
  }
  return date >= historyCutoffDate()
}

export function authorityReferenceDate(record: AuthorityRecord) {
  return (
    record.expiryDate ||
    record.eventDate ||
    record.effectiveDate ||
    record.issueDate ||
    record.createdAt
  )
}

export function safetyReferenceDate(record: SafetyRecord) {
  return record.reviewDate || record.createdAt
}

export function auditReferenceDate(record: AuditRecord) {
  return record.completedDate || record.noticeDate || record.createdAt
}

/* =========================================================
   GLOBAL DUPLICATION DETECTION / AUTHORITY CONFIG
========================================================= */
export function findGlobalAuthorityConflict({
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

export function authorityDisplayName(type: AuthorityType) {
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

export function defaultIssuingAuthority(type: AuthorityType) {
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

export function authorityOptions(
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

export function emptyAuthorityDraft(
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

export function emptySafetyDraft(company: Company, system: SafetySystem): SafetyDraft {
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

export function emptyAuditDraft(company: Company): AuditDraft {
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
