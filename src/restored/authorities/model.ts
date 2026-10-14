/**
 * Pure model helpers of the restored Authorities workspace.
 *
 * These are the original presentation rules (company applicability, 3-year retention window, option lists, draft defaults)
 * copied from the pre-cutover model WITHOUT its browser-storage functions (company list, deadline settings, cross-store
 * snapshots, global duplicate scan). Persistence belongs to the canonical API (see adapter.ts); nothing in this file reads or
 * writes browser storage.
 */

import { JURISDICTIONS } from "@/lib/jurisdictions"
import { KIND_DEFINITIONS } from "@/lib/operating-authorities/definitions"
import type {
  AuditDraft,
  AuditRecord,
  AuthorityCategory,
  AuthorityDraft,
  AuthorityRecord,
  AuthorityType,
  CanonicalAuthorityKind,
  Company,
  DeadlineRules,
  DeadlineStatus,
  SafetyDraft,
  SafetyRecord,
  SafetySystem,
  StoredAuthoritiesData,
} from "./types"

const THREE_YEAR_HISTORY = 3

export const EMPTY_DATA: StoredAuthoritiesData = {
  version: 3,
  authorities: [],
  safety: [],
  audits: [],
  evidence: [],
}

/* =========================================================
   DEADLINES (pure copy of the deadline mechanics; thresholds are the TES defaults)
========================================================= */

export const DEFAULT_DEADLINE_RULES: DeadlineRules = {
  healthyMinDays: 61,
  watchMinDays: 31,
  urgentMinDays: 11,
  criticalMinDays: 0,
  criticalMaxDays: 10,
}

function daysRemaining(targetDate: string): number | null {
  const target = new Date(`${targetDate}T23:59:59`)
  if (Number.isNaN(target.getTime())) return null
  const now = new Date()
  const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.ceil((target.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24))
}

export function getDeadlineStatus(targetDate?: string, rules: DeadlineRules = DEFAULT_DEADLINE_RULES): DeadlineStatus {
  if (!targetDate || targetDate.trim() === "" || targetDate.toLowerCase() === "continuous") return "No Deadline"
  const days = daysRemaining(targetDate)
  if (days === null) return "No Deadline"
  if (days < 0) return "Expired"
  if (days >= rules.criticalMinDays && days <= rules.criticalMaxDays) return "Critical"
  if (days >= rules.urgentMinDays && days < rules.watchMinDays) return "Urgent"
  if (days >= rules.watchMinDays && days < rules.healthyMinDays) return "Watch"
  return "Healthy"
}

export function getDeadlineClasses(status: DeadlineStatus) {
  switch (status) {
    case "Healthy":
      return { badge: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300", left: "border-l-emerald-500" }
    case "Watch":
      return { badge: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300", left: "border-l-amber-400" }
    case "Urgent":
      return { badge: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300", left: "border-l-orange-500" }
    case "Critical":
      return { badge: "border-red-400 bg-red-100 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 font-semibold", left: "border-l-red-600" }
    case "Expired":
      return { badge: "border-red-900 bg-red-950 text-white dark:border-red-700 dark:bg-red-900 font-bold", left: "border-l-red-950" }
    default:
      return { badge: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400", left: "border-l-slate-300 dark:border-l-slate-700" }
  }
}

/* =========================================================
   HELPERS
========================================================= */

export function isoNow() {
  return new Date().toISOString()
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function normalizeText(value?: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

/* =========================================================
   COMPANY APPLICABILITY
========================================================= */

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
      (country.includes("canada") && !region.includes("united states") && !region.includes("usa")))

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
    showUS = country.includes("united states") || country === "usa" || country === "us"
  }

  const hazmat = company.hazmat === true

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
  if (!dateValue) return true
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return true
  return date >= historyCutoffDate()
}

export function authorityReferenceDate(record: AuthorityRecord) {
  return record.expiryDate || record.eventDate || record.effectiveDate || record.issueDate || record.createdAt
}

export function safetyReferenceDate(record: SafetyRecord) {
  return record.reviewDate || record.createdAt
}

export function auditReferenceDate(record: AuditRecord) {
  return record.completedDate || record.noticeDate || record.createdAt
}

/* =========================================================
   TYPE / KIND VOCABULARY
========================================================= */

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
    case "IRP":
      return "IRP Account (International Registration Plan)"
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

/** The canonical kinds each original record type can mean. A type with no entry has no canonical kind. */
export const KIND_CHOICES: Partial<Record<AuthorityType, CanonicalAuthorityKind[]>> = {
  PROVINCIAL_CARRIER_IDENTIFIER: ["MVID", "RIN"],
  CANADIAN_SAFETY_AUTHORITY: ["SAFETY_FITNESS", "CVOR"],
  USDOT: ["USDOT"],
  MC: ["MC"],
  IRP: ["IRP"],
}

export const KIND_LABEL: Record<CanonicalAuthorityKind, string> = {
  USDOT: "USDOT Number",
  MC: "MC Operating Authority (docket)",
  MVID: "MVID (provincial motor-vehicle client identifier)",
  RIN: "RIN (Ontario Registrant Identification Number)",
  CVOR: "CVOR (Ontario operator registration)",
  SAFETY_FITNESS: "NSC / Safety Fitness Certificate",
  IRP: "IRP account",
}

/** Record name shown on cards: the original type name made specific to the canonical kind. */
export function kindDisplayName(kind: CanonicalAuthorityKind): string {
  switch (kind) {
    case "MVID":
      return "Provincial Carrier Identifier (MVID)"
    case "RIN":
      return "Provincial Carrier Identifier (RIN)"
    case "SAFETY_FITNESS":
      return "NSC / Safety Fitness Certificate"
    case "CVOR":
      return "CVOR"
    default:
      return authorityDisplayName(typeForKind(kind).type)
  }
}

export function typeForKind(kind: CanonicalAuthorityKind): { category: AuthorityCategory; type: AuthorityType } {
  switch (kind) {
    case "USDOT":
      return { category: "us_federal", type: "USDOT" }
    case "MC":
      return { category: "us_federal", type: "MC" }
    case "MVID":
    case "RIN":
      return { category: "canadian", type: "PROVINCIAL_CARRIER_IDENTIFIER" }
    case "SAFETY_FITNESS":
    case "CVOR":
      return { category: "canadian", type: "CANADIAN_SAFETY_AUTHORITY" }
    case "IRP":
      return { category: "operating_registration", type: "IRP" }
  }
}

/** Issuer implied by the KIND itself (regulatory semantics): a kind-defining fact, not a stored value. */
export function issuerForKind(kind: CanonicalAuthorityKind, regionLabel: string): string {
  switch (kind) {
    case "USDOT":
    case "MC":
      return "FMCSA"
    case "CVOR":
      return "Ontario MTO"
    case "RIN":
      return "Ontario MTO / ServiceOntario"
    case "MVID":
    case "SAFETY_FITNESS":
      return regionLabel ? `${regionLabel} (issuing province / territory)` : ""
    case "IRP":
      return regionLabel ? `${regionLabel} (IRP base jurisdiction)` : ""
  }
}

export const kindIsNational = (kind: CanonicalAuthorityKind) => KIND_DEFINITIONS[kind].jurisdictionScope === "NATIONAL"
export const kindFixedRegion = (kind: CanonicalAuthorityKind) => KIND_DEFINITIONS[kind].fixedRegion
export const kindHasExpiry = (kind: CanonicalAuthorityKind) => KIND_DEFINITIONS[kind].hasExpiry
/** Regulatory semantics: a national number (USDOT, MC) never changes in place (corrections only); an IRP base move is a real change. */
export const kindNumberIsPermanent = (kind: CanonicalAuthorityKind) => kindIsNational(kind)

export function authorityOptions(category: AuthorityCategory, profile: AuthorityProfile): { value: AuthorityType; label: string }[] {
  if (category === "canadian") {
    return [
      { value: "PROVINCIAL_CARRIER_IDENTIFIER", label: "Provincial Carrier Identifier (MVID / RIN)" },
      { value: "CANADIAN_SAFETY_AUTHORITY", label: "NSC / Safety Fitness Certificate / CVOR" },
    ]
  }

  if (category === "us_federal") {
    return [
      { value: "USDOT", label: "USDOT Number" },
      { value: "MC", label: "MC Operating Authority" },
      { value: "MCS150", label: "MCS-150 Biennial Update" },
    ]
  }

  const options: { value: AuthorityType; label: string }[] = []
  if (profile.showUCR) options.push({ value: "UCR", label: "Unified Carrier Registration (UCR)" })
  if (profile.showPHMSA) options.push({ value: "PHMSA", label: "PHMSA Registration" })
  options.push({ value: "IRP", label: "IRP Account (International Registration Plan)" })
  return options
}

/* =========================================================
   JURISDICTION <-> CANONICAL CODES
========================================================= */

export function jurisdictionFromCanonical(country: string | null, region: string | null): { code: string; label: string; country: string } {
  const countryName = country === "CA" ? "Canada" : country === "US" ? "United States" : country || ""
  if (region) {
    const found = JURISDICTIONS.find((item) => item.code === region && item.country === countryName)
    return { code: region, label: found?.label ?? region, country: countryName }
  }
  if (country === "CA") return { code: "CA-FED", label: "Federal — Canada", country: "Canada" }
  return { code: "US-FED", label: "Federal — United States", country: countryName || "United States" }
}

/** Canonical jurisdiction input for a draft: undefined for national kinds, otherwise explicit country and region codes. */
export function jurisdictionToCanonical(kind: CanonicalAuthorityKind, draft: Pick<AuthorityDraft, "jurisdictionCode" | "country">): { country: string; region: string } | undefined {
  if (kindIsNational(kind)) return undefined
  const fixed = kindFixedRegion(kind)
  const code = fixed ?? draft.jurisdictionCode
  const found = JURISDICTIONS.find((item) => item.code === code)
  const country = found ? (found.country === "Canada" ? "CA" : "US") : draft.country === "Canada" ? "CA" : "US"
  return { country, region: code }
}

/* =========================================================
   DRAFTS
========================================================= */

function defaultJurisdictionFor(company: Company, category: AuthorityCategory) {
  if (category === "us_federal" || category === "operating_registration") {
    return { code: "US-FED", label: "Federal — United States", country: "United States" }
  }
  const state = normalizeText(company.regCorpState)
  const found = JURISDICTIONS.find(
    (item) => item.country === "Canada" && (normalizeText(item.code) === state || normalizeText(item.label) === state),
  )
  return found || { code: "CA-FED", label: "Federal — Canada", country: "Canada" }
}

export function defaultKindFor(type: AuthorityType): CanonicalAuthorityKind | "" {
  return KIND_CHOICES[type]?.[0] ?? ""
}

export function emptyAuthorityDraft(company: Company, category: AuthorityCategory, type?: AuthorityType): AuthorityDraft {
  const jurisdiction = defaultJurisdictionFor(company, category)
  const authorityType = type || (category === "canadian" ? "PROVINCIAL_CARRIER_IDENTIFIER" : category === "us_federal" ? "USDOT" : "UCR")

  return {
    category,
    authorityType,
    canonicalKind: defaultKindFor(authorityType),
    name: defaultKindFor(authorityType) ? kindDisplayName(defaultKindFor(authorityType) as CanonicalAuthorityKind) : authorityDisplayName(authorityType),
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

  const jurisdiction = JURISDICTIONS.find(
    (item) => item.country === country && normalizeText(item.label) === normalizeText(company.regCorpState),
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
