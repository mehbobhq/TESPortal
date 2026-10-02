/**
 * Mandatory "Check for Existing Driver" - pure matching logic.
 *
 * DriverMaster is TES's global (cross-company) human identity;
 * CompanyDriverRelationship is the per-company link. Before a company creates
 * a driver, this searches ALL existing DriverMasters (system-wide, not just
 * the current company) for a candidate. It never merges or selects anything:
 * it only reports candidates for a human to confirm or dismiss.
 *
 * Matching rule (follows lib/duplicate-detection.ts's comparePersonIdentity
 * convention - "Name + Phone/Email" is a strong compound match, and a name
 * alone is NEVER a match): normalized first name AND normalized last name AND
 * (normalized email OR normalized phone). Normalization is exact, not fuzzy:
 * trim + collapse whitespace + case-insensitive for names, lowercase for
 * email, digits-only (NANP leading 1 dropped) for phone. There is
 * deliberately no nickname/phonetic matching - that infrastructure does not
 * exist in this codebase and is a known limitation.
 *
 * `licenceNumber` is reserved on the input so the later OCR/licence phase can
 * call this same function again with a licence number for a second
 * system-wide check without re-architecting. It is NOT used here.
 *
 * Pure: all data comes in through `context`, so this is unit-testable and
 * performs no reads/writes of its own (in particular it never triggers a
 * storage migration for another company's data).
 */

import type { CompanyDriverRelationship, DriverMaster } from "@/lib/driver-data"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (this module is unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { normalizeEmail, normalizeName } from "./identifier-normalization.ts"

export interface ExistingDriverCheckInput {
  legalFirstName: string
  legalLastName: string
  email: string
  phone: string
  /** Reserved for the later licence-based system-wide re-check. Not used by this phase. */
  licenceNumber?: string
}

export interface ExistingDriverAffiliation {
  companyId: string
  companyName: string
  recordType: string
  driverStatus: string
}

export interface ExistingDriverCandidate {
  master: DriverMaster
  matchedOn: Array<"EMAIL" | "PHONE">
  /** Active (non-archived) company relationships this DriverMaster already has, at any company. */
  affiliations: ExistingDriverAffiliation[]
  /** True when this DriverMaster already has an active relationship with the CURRENT company (it cannot be attached again). */
  activeAtCurrentCompany: boolean
}

export interface ExistingDriverCheckContext {
  currentCompanyId: string
  drivers: DriverMaster[]
  companies: Array<{ id: string; name: string }>
  /** Must be a read-only lookup. A throw means that company's relationships are unreadable (reported, never treated as "none"). */
  relationshipsFor: (companyId: string) => CompanyDriverRelationship[]
}

export interface ExistingDriverCheckResult {
  /** Normalized key of the four mandatory fields this result was computed for. */
  key: string
  candidates: ExistingDriverCandidate[]
  /** Companies whose relationships could not be read - affiliations for these are UNKNOWN, not absent. */
  unreadableCompanyIds: string[]
}

const nameKey = (value: string) => normalizeName(value || "").toLowerCase()
const emailKey = (value: string) => normalizeEmail(value || "")

/** Digits only; a NANP leading 1 on an 11-digit number is dropped. Fewer than 7 digits is not comparable. */
export function phoneKey(value: string): string {
  const digits = String(value || "").replace(/\D/g, "")
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  return national.length >= 7 ? national : ""
}

export function hasMandatoryIdentityFields(input: Pick<ExistingDriverCheckInput, "legalFirstName" | "legalLastName" | "email" | "phone">): boolean {
  return Boolean(nameKey(input.legalFirstName) && nameKey(input.legalLastName) && emailKey(input.email) && String(input.phone || "").trim())
}

/** Identifies exactly the values a check was run for. A check is only valid while this key is unchanged. */
export function existingDriverCheckKey(input: Pick<ExistingDriverCheckInput, "legalFirstName" | "legalLastName" | "email" | "phone">): string {
  return [nameKey(input.legalFirstName), nameKey(input.legalLastName), emailKey(input.email), phoneKey(input.phone) || String(input.phone || "").trim()].join("|")
}

export function findExistingDriverCandidates(input: ExistingDriverCheckInput, context: ExistingDriverCheckContext): ExistingDriverCheckResult {
  const key = existingDriverCheckKey(input)
  const first = nameKey(input.legalFirstName)
  const last = nameKey(input.legalLastName)
  const email = emailKey(input.email)
  const phone = phoneKey(input.phone)

  const matched: Array<{ master: DriverMaster; matchedOn: Array<"EMAIL" | "PHONE"> }> = []
  if (first && last) {
    for (const master of context.drivers) {
      if (master.archive?.isArchived) continue
      if (nameKey(master.identity.legalFirstName) !== first || nameKey(master.identity.legalLastName) !== last) continue
      const matchedOn: Array<"EMAIL" | "PHONE"> = []
      if (email && emailKey(master.identity.email || "") === email) matchedOn.push("EMAIL")
      if (phone && phoneKey(master.identity.phone || "") === phone) matchedOn.push("PHONE")
      if (matchedOn.length) matched.push({ master, matchedOn })
    }
  }

  const unreadable = new Set<string>()
  const relationships = new Map<string, CompanyDriverRelationship[]>()
  if (matched.length) {
    for (const company of context.companies) {
      try {
        relationships.set(company.id, context.relationshipsFor(company.id))
      } catch {
        unreadable.add(company.id)
      }
    }
  }

  const candidates: ExistingDriverCandidate[] = matched.map(({ master, matchedOn }) => {
    const affiliations: ExistingDriverAffiliation[] = []
    for (const company of context.companies) {
      for (const relationship of relationships.get(company.id) || []) {
        if (relationship.driverMasterId !== master.id || relationship.archive?.isArchived) continue
        affiliations.push({ companyId: company.id, companyName: company.name, recordType: relationship.recordType, driverStatus: relationship.driverStatus })
      }
    }
    return { master, matchedOn, affiliations, activeAtCurrentCompany: affiliations.some((a) => a.companyId === context.currentCompanyId) }
  })

  candidates.sort((a, b) => b.matchedOn.length - a.matchedOn.length || a.master.id.localeCompare(b.master.id))
  return { key, candidates, unreadableCompanyIds: [...unreadable] }
}
