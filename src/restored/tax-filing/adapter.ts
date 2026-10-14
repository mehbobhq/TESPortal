"use client"

/**
 * Canonical adapter for the restored Tax Filing workspace.
 *
 * Hydrates the original program list / profile shapes from the canonical tax-registrations domain and company-profile TAX rule
 * applicability, and implements the original profile callbacks through /api/companies/[id]/tax-registrations. The canonical
 * system has NO filing, obligation, frequency-history or tax-evidence entities: those controls stay visible and refuse with
 * CanonicalOperationUnavailableError, and nothing is written to the browser.
 */

import { useCallback, useEffect, useMemo, useState } from "react"

import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import { JURISDICTIONS } from "@/lib/jurisdictions"
import type { RegistrationView } from "@/lib/tax-registrations/types"
import { TAX_DEFINITIONS } from "@/src/components/tax-filing/tax-definitions"
import { isValidISODate } from "@/src/components/tax-filing/tax-helpers"
import type { Company, RuleValue, TaxCode } from "@/src/components/tax-filing/types"
import {
  PROGRAM_BY_TAX_CODE,
  RULE_CODE_BY_TAX_CODE,
  STATUS_TO_CANONICAL,
  applicabilityFromCanonical,
  isBaseJurisdictionProgram,
  mapRegistrationView,
  programAllowsIdentityChange,
} from "./model"
import type { EditMode, RestoredTaxProfile } from "./types"

type LoadState = "loading" | "ready" | "denied" | "error" | "missing"

type ProfileRecord = {
  id: string
  name: string
  kind: string
  status: string
  opRegion: "Canada Only" | "US Only" | "Cross-Border" | null
  regCorpState: string | null
  regCorpCountry: string | null
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { cache: "no-store", ...init })
  } catch {
    throw new Error("The server could not be reached. Nothing was saved.")
  }
}

async function failure(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null)
  return new Error(typeof body?.error === "string" && body.error ? body.error : fallback)
}

const timestamp = (date: string) => `${date}T00:00:00Z`

export const NO_FILING_DOMAIN =
  "TES records tax registrations only. Filing obligations, filing frequency history, filing records and tax evidence have no canonical PostgreSQL storage yet, so this cannot be saved (and nothing is kept in this browser)."

export type CanonicalTaxFiling = {
  state: LoadState
  company: Company | null
  profiles: RestoredTaxProfile[]
  applicability: Record<TaxCode, RuleValue>
  /** False when the company's settings could not be read: applicability is then unknown, never assumed. */
  applicabilityKnown: boolean
  reload: () => Promise<void>
  saveProfile: (draft: RestoredTaxProfile, mode: EditMode) => Promise<void>
  archive: (profile: RestoredTaxProfile) => Promise<void>
  restore: (profile: RestoredTaxProfile) => Promise<void>
  checkNumber: (draft: RestoredTaxProfile) => Promise<string>
}

const ALL_NOT_CONFIGURED = Object.fromEntries(TAX_DEFINITIONS.map((definition) => [definition.code, "not-configured"])) as Record<TaxCode, RuleValue>

export function useCanonicalTaxFiling(companyId: string): CanonicalTaxFiling {
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const [state, setState] = useState<LoadState>("loading")
  const [company, setCompany] = useState<Company | null>(null)
  const [profiles, setProfiles] = useState<RestoredTaxProfile[]>([])
  const [applicability, setApplicability] = useState<Record<TaxCode, RuleValue>>(ALL_NOT_CONFIGURED)
  const [applicabilityKnown, setApplicabilityKnown] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [profileResponse, listResponse, settingsResponse] = await Promise.all([
        request(`${base}/profile`),
        request(`${base}/tax-registrations`),
        request(`${base}/settings`),
      ])
      if (profileResponse.status === 404) return setState("missing")
      if (!profileResponse.ok) return setState("error")
      if (listResponse.status === 403) return setState("denied")
      if (!listResponse.ok) return setState("error")
      const record = ((await profileResponse.json().catch(() => null))?.company ?? null) as ProfileRecord | null
      if (!record) return setState("error")
      const list = (await listResponse.json().catch(() => null))?.registrations as RegistrationView[] | undefined
      if (!Array.isArray(list)) return setState("error")

      // Applicability of each original program comes from the company's canonical TAX rules. Unreadable settings leave every
      // program "not configured"; nothing is assumed.
      const rules: Record<TaxCode, RuleValue> = { ...ALL_NOT_CONFIGURED }
      let known = false
      if (settingsResponse.ok) {
        const settings = await settingsResponse.json().catch(() => null)
        if (Array.isArray(settings?.rules)) {
          known = true
          for (const definition of TAX_DEFINITIONS) {
            const entry = settings.rules.find((item: { rule?: { code?: string } }) => item.rule?.code === RULE_CODE_BY_TAX_CODE[definition.code])
            rules[definition.code] = applicabilityFromCanonical(entry?.effective)
          }
        }
      }

      setCompany({
        id: record.id,
        name: record.name,
        kind: record.kind,
        status: record.status,
        regCorpState: record.regCorpState ?? undefined,
        regCorpCountry: record.regCorpCountry ?? undefined,
        region: record.opRegion ?? "",
      })
      setProfiles(list.map(mapRegistrationView).filter((item): item is RestoredTaxProfile => item !== null))
      setApplicability(rules)
      setApplicabilityKnown(known)
      setState("ready")
    } catch {
      setState("error")
    }
  }, [base])

  useEffect(() => {
    void reload()
  }, [reload])

  const patch = useCallback(
    async (registrationId: string, body: Record<string, unknown>): Promise<void> => {
      const response = await request(`${base}/tax-registrations/${encodeURIComponent(registrationId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw await failure(response, "The change could not be saved.")
    },
    [base],
  )

  const jurisdictionOf = (draft: RestoredTaxProfile) => {
    const region = draft.jurisdictionRegion?.trim()
    if (!region) return undefined
    const found = JURISDICTIONS.find((item) => item.code === region)
    return { country: found ? (found.country === "Canada" ? "CA" : "US") : draft.jurisdictionCountry === "CA" ? "CA" : "US", region }
  }

  const saveProfile = useCallback<CanonicalTaxFiling["saveProfile"]>(
    async (draft, mode) => {
      const program = PROGRAM_BY_TAX_CODE[draft.taxCode]
      const definition = TAX_DEFINITIONS.find((item) => item.code === draft.taxCode)
      if (!program) {
        throw new CanonicalOperationUnavailableError(
          "Saving a Form 2290 profile",
          "Form 2290 is a federal filing under the company's EIN and has no registration identity in TES, so there is nothing canonical to save it to.",
        )
      }

      // Validation carried over from the original profile form.
      if ((draft.effectiveDate && !isValidISODate(draft.effectiveDate)) || (draft.closureDate && !isValidISODate(draft.closureDate)) || (draft.lastVerifiedDate && !isValidISODate(draft.lastVerifiedDate))) {
        throw new Error("Enter valid profile dates in YYYY-MM-DD format.")
      }
      if ((draft.issuedOn && !isValidISODate(draft.issuedOn)) || (draft.expiresOn && !isValidISODate(draft.expiresOn))) throw new Error("Enter valid Issued On and Expires On dates in YYYY-MM-DD format.")
      if (draft.effectiveDate && draft.closureDate && draft.closureDate < draft.effectiveDate) throw new Error("Closure Date cannot be earlier than Effective Date.")
      if (!draft.accountNumber?.trim()) {
        throw new Error(`${definition?.accountLabel ?? "Account Number"} is required to save this profile in the TES registry.`)
      }

      // Fields with no canonical home are refused, never accepted and dropped.
      const noHome: string[] = []
      if (draft.verificationSource) noHome.push("Verification Source")
      if (draft.verificationReference?.trim()) noHome.push("Verification Reference")
      if (draft.lastVerifiedDate?.trim()) noHome.push("Last Verified Date")
      if (draft.lastVerifiedBy?.trim()) noHome.push("Last Verified By")
      if (draft.notes?.trim()) noHome.push("Notes")
      if (draft.frequencyHistory.length > 0) noHome.push("Filing Frequency History")
      if (noHome.length > 0) {
        throw new CanonicalOperationUnavailableError(
          `Saving ${noHome.join(", ")}`,
          "these fields have no canonical home yet and would be lost. Clear them to save the rest of the profile.",
        )
      }

      const baseRegion = isBaseJurisdictionProgram(program)
      const jurisdiction = baseRegion ? jurisdictionOf(draft) : undefined
      if (baseRegion && !jurisdiction) throw new Error("Select the base jurisdiction that issued this account.")
      const status = STATUS_TO_CANONICAL[draft.accountStatus] ?? "ACTIVE"
      const issuedOn = draft.issuedOn?.trim() ?? ""
      const expiresOn = draft.expiresOn?.trim() ?? ""

      /* ------------------------------------------------------------------ create */
      if (!draft.persisted) {
        if (draft.closureDate?.trim()) {
          throw new CanonicalOperationUnavailableError("Recording a Closure Date on a new profile", "a closure is recorded as the date an existing registration's status became Closed; save the profile first, then close it.")
        }
        const payload: Record<string, unknown> = { program, number: draft.accountNumber.trim(), status }
        if (jurisdiction) payload.jurisdiction = jurisdiction
        if (issuedOn) payload.issuedOn = issuedOn
        if (expiresOn) payload.expiresOn = expiresOn
        if (draft.effectiveDate?.trim()) payload.effectiveFrom = timestamp(draft.effectiveDate.trim())
        const response = await request(`${base}/tax-registrations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
        if (!response.ok) throw await failure(response, "The tax profile could not be saved.")
        await reload()
        return
      }

      /* ------------------------------------------------------------------ edit: a real-world change vs a correction */
      const original = profiles.find((item) => item.id === draft.id)
      if (!original) throw new Error("This profile is no longer available. Reload the page.")
      if (original.isArchived) throw new Error("An archived profile cannot be edited. Restore it first.")

      const changes: Record<string, unknown> = {}
      if (draft.accountNumber.trim() !== (original.accountNumber ?? "")) changes.number = draft.accountNumber.trim()
      if (jurisdiction && (jurisdiction.region !== (original.jurisdictionRegion ?? "") || jurisdiction.country !== (original.jurisdictionCountry ?? jurisdiction.country))) changes.jurisdiction = jurisdiction
      if (issuedOn !== (original.issuedOn ?? "")) changes.issuedOn = issuedOn || null
      if (expiresOn !== (original.expiresOn ?? "")) changes.expiresOn = expiresOn || null
      const effectiveChanged = (draft.effectiveDate ?? "") !== (original.effectiveDate ?? "")
      const closureChanged = (draft.closureDate ?? "") !== (original.closureDate ?? "")
      const statusChanged = status !== (STATUS_TO_CANONICAL[original.accountStatus] ?? "")

      if (closureChanged && !(status === "CLOSED" && statusChanged)) {
        throw new CanonicalOperationUnavailableError("Changing the Closure Date", "the closure date is the moment the status became Closed; set the status to Closed together with the date, or correct the status.")
      }
      if (mode === "correct" && (effectiveChanged || closureChanged)) {
        throw new CanonicalOperationUnavailableError("Correcting an effective or closure date", "a correction replaces the recorded values but keeps the original effective time; record a real-world change to move it.")
      }
      if (mode === "change" && ("number" in changes || "jurisdiction" in changes) && !programAllowsIdentityChange(program)) {
        throw new Error(`A ${definition?.shortName ?? program} account number and issuing jurisdiction do not change in place. If the recorded value was wrong, choose 'The recorded value was wrong' and correct it.`)
      }
      if (Object.keys(changes).length === 0 && !statusChanged) throw new Error("Nothing was changed.")

      if (Object.keys(changes).length > 0) {
        const body: Record<string, unknown> = { ...changes, action: mode === "correct" ? "correctVersion" : "version" }
        if (mode === "change" && effectiveChanged && draft.effectiveDate?.trim()) body.effectiveFrom = timestamp(draft.effectiveDate.trim())
        await patch(original.id, body)
      }
      if (statusChanged) {
        try {
          const body: Record<string, unknown> = { action: mode === "correct" ? "correctStatus" : "status", status }
          if (mode === "change" && status === "CLOSED" && draft.closureDate?.trim()) body.effectiveFrom = timestamp(draft.closureDate.trim())
          await patch(original.id, body)
        } catch (error) {
          await reload()
          const message = error instanceof Error ? error.message : "The status could not be saved."
          throw new Error(Object.keys(changes).length > 0 ? `The account details were saved, but the status was not: ${message}` : message)
        }
      }
      await reload()
    },
    [base, patch, profiles, reload],
  )

  const archive = useCallback<CanonicalTaxFiling["archive"]>(
    async (profile) => {
      await patch(profile.id, { action: "archive" })
      await reload()
    },
    [patch, reload],
  )

  const restore = useCallback<CanonicalTaxFiling["restore"]>(
    async (profile) => {
      await patch(profile.id, { action: "restore" })
      await reload()
    },
    [patch, reload],
  )

  const checkNumber = useCallback<CanonicalTaxFiling["checkNumber"]>(
    async (draft) => {
      const program = PROGRAM_BY_TAX_CODE[draft.taxCode]
      if (!program) throw new CanonicalOperationUnavailableError("Number check", "Form 2290 has no registration identity in TES.")
      if (!draft.accountNumber?.trim()) throw new Error("Enter an account number to check.")
      const jurisdiction = isBaseJurisdictionProgram(program) ? jurisdictionOf(draft) : undefined
      if (isBaseJurisdictionProgram(program) && !jurisdiction) throw new Error("Select the base jurisdiction first.")
      const response = await request(`${base}/tax-registrations/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ program, number: draft.accountNumber.trim(), ...(jurisdiction ? { jurisdiction } : {}) }),
      })
      if (!response.ok) throw await failure(response, "The number could not be checked.")
      const result = (await response.json().catch(() => null)) as { registered?: boolean; match?: { organizationLegalName?: string } | null } | null
      if (!result?.registered) return "This account number is not registered to any company."
      return result.match?.organizationLegalName ? `This account number is already registered to ${result.match.organizationLegalName}.` : "This account number is already registered (to this or another company)."
    },
    [base],
  )

  return useMemo(
    () => ({ state, company, profiles, applicability, applicabilityKnown, reload, saveProfile, archive, restore, checkNumber }),
    [state, company, profiles, applicability, applicabilityKnown, reload, saveProfile, archive, restore, checkNumber],
  )
}
