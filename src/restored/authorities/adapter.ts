"use client"

/**
 * Canonical adapter for the restored Authorities workspace.
 *
 * Hydrates the original in-memory record shape (cards, inspector, drafts) from the canonical PostgreSQL API and implements the
 * original callbacks by calling it. Nothing here touches browser storage. Anything the canonical store has no home for
 * (safety snapshots, audit records, evidence, display names, issuing-authority text, notes, filing dates, archive reasons, the
 * MCS150 / UCR / PHMSA / OTHER kinds) is refused with CanonicalOperationUnavailableError; it is never dropped silently.
 */

import { useCallback, useEffect, useMemo, useState } from "react"

import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import type { AuthorityView, VersionRecord } from "@/lib/operating-authorities/types"
import {
  issuerForKind,
  jurisdictionFromCanonical,
  jurisdictionToCanonical,
  kindDisplayName,
  kindFixedRegion,
  kindHasExpiry,
  kindNumberIsPermanent,
  typeForKind,
} from "./model"
import type { AuthorityDraft, AuthorityRecord, AuthorityStatusHistory, AuthorityVersionHistory, CanonicalAuthorityKind, Company } from "./types"

/* ------------------------------------------------------------------------------------------------ vocabulary */

const STATUS_TO_UI: Record<string, AuthorityRecord["status"]> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  SUSPENDED: "Suspended",
  REVOKED: "Revoked",
  CANCELED: "Canceled",
}
const STATUS_TO_CANONICAL: Record<string, string> = Object.fromEntries(Object.entries(STATUS_TO_UI).map(([canonical, ui]) => [ui, canonical]))

export type EditMode = "change" | "correct"

const date = (value: string | null | undefined): string | undefined => (value ? value.slice(0, 10) : undefined)

const NO_CANONICAL_KIND = "TES stores operating authorities as USDOT, MC, MVID, RIN, CVOR, NSC / Safety Fitness and IRP records only; this record type has no canonical kind yet."

/* ------------------------------------------------------------------------------------------------ mapping */

function mapVersion(version: VersionRecord): AuthorityVersionHistory {
  const where = jurisdictionFromCanonical(version.jurisdictionCountry, version.jurisdictionRegion)
  return {
    id: version.id,
    number: version.numberDisplay,
    jurisdictionLabel: where.label,
    country: where.country,
    issueDate: date(version.issuedOn),
    expiryDate: date(version.expiresOn),
    reason: version.versionReason,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    corrected: version.recordStatus === "corrected",
  }
}

/** Canonical authority view -> the record shape the original cards and inspector expect. */
export function mapAuthorityView(view: AuthorityView): AuthorityRecord {
  const kind = view.authority.kind as CanonicalAuthorityKind
  const { category, type } = typeForKind(kind)
  const version = view.current.version ?? [...view.versions].filter((item) => item.recordStatus === "active").sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? view.versions[0]
  const where = jurisdictionFromCanonical(version?.jurisdictionCountry ?? null, version?.jurisdictionRegion ?? null)
  const archived = view.authority.recordStatus === "archived"
  const status = STATUS_TO_UI[view.current.status?.authorityStatus ?? ""] ?? "Pending"
  const touched = [view.authority.createdAt, ...view.versions.map((item) => item.createdAt), ...view.statusPeriods.map((item) => item.createdAt)].sort()
  return {
    id: view.authority.id,
    category,
    authorityType: type,
    canonicalKind: kind,
    name: kindDisplayName(kind),
    number: version?.numberDisplay ?? "",
    issuingAuthority: issuerForKind(kind, where.code.endsWith("-FED") ? "" : where.label),
    jurisdictionCode: where.code,
    jurisdictionLabel: where.label,
    country: where.country,
    status,
    issueDate: date(version?.issuedOn),
    effectiveDate: date(version?.effectiveFrom),
    expiryDate: date(version?.expiresOn),
    notes: undefined,
    evidenceIds: [],
    source: "Manual",
    createdAt: view.authority.createdAt,
    updatedAt: touched[touched.length - 1] ?? view.authority.createdAt,
    isArchived: archived,
    archivedAt: view.authority.archivedAt ?? undefined,
    versions: view.versions.map(mapVersion),
    statusPeriods: view.statusPeriods.map(
      (period): AuthorityStatusHistory => ({
        id: period.id,
        status: STATUS_TO_UI[period.authorityStatus] ?? period.authorityStatus,
        reason: period.periodReason,
        effectiveFrom: period.effectiveFrom,
        effectiveTo: period.effectiveTo,
        corrected: period.recordStatus === "corrected",
      }),
    ),
  }
}

/* ------------------------------------------------------------------------------------------------ transport */

async function request(url: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, { cache: "no-store", ...init })
  } catch {
    throw new Error("The server could not be reached. Nothing was saved.")
  }
  return response
}

async function failure(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null)
  return new Error(typeof body?.error === "string" && body.error ? body.error : fallback)
}

/* ------------------------------------------------------------------------------------------------ hook */

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

export type CanonicalAuthorities = {
  state: LoadState
  company: Company | null
  records: AuthorityRecord[]
  reload: () => Promise<void>
  saveAuthority: (draft: AuthorityDraft, editing?: { record: AuthorityRecord; mode: EditMode }) => Promise<AuthorityRecord | null>
  archive: (record: AuthorityRecord, reason: string) => Promise<void>
  restore: (record: AuthorityRecord) => Promise<void>
  checkNumber: (draft: AuthorityDraft) => Promise<string>
}

export function useCanonicalAuthorities(companyId: string): CanonicalAuthorities {
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const [state, setState] = useState<LoadState>("loading")
  const [company, setCompany] = useState<Company | null>(null)
  const [records, setRecords] = useState<AuthorityRecord[]>([])

  const reload = useCallback(async () => {
    try {
      const [profileResponse, listResponse, settingsResponse] = await Promise.all([
        request(`${base}/profile`),
        request(`${base}/authorities`),
        request(`${base}/settings`),
      ])
      if (profileResponse.status === 404) return setState("missing")
      if (!profileResponse.ok) return setState("error")
      if (listResponse.status === 403) return setState("denied")
      if (!listResponse.ok) return setState("error")
      const profile = ((await profileResponse.json().catch(() => null))?.company ?? null) as ProfileRecord | null
      if (!profile) return setState("error")
      const list = (await listResponse.json().catch(() => null))?.authorities as AuthorityView[] | undefined
      if (!Array.isArray(list)) return setState("error")

      // Hazmat trigger: only an EXPLICIT company assertion that dangerous goods / hazmat apply (the catalogue default is an
      // assumption, not a fact about this company). Unreadable settings leave the trigger off and say nothing more.
      let hazmat = false
      if (settingsResponse.ok) {
        const settings = await settingsResponse.json().catch(() => null)
        const rules = Array.isArray(settings?.rules) ? settings.rules : []
        hazmat = rules.some(
          (entry: { rule?: { code?: string }; assertion?: { applicability?: string } | null }) =>
            (entry.rule?.code === "DG_US" || entry.rule?.code === "DG_CANADA") && entry.assertion?.applicability === "APPLIES",
        )
      }

      setCompany({
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        status: profile.status,
        regCorpState: profile.regCorpState ?? undefined,
        regCorpCountry: profile.regCorpCountry ?? undefined,
        region: profile.opRegion ?? "",
        hazmat,
      })
      setRecords(list.map(mapAuthorityView))
      setState("ready")
    } catch {
      setState("error")
    }
  }, [base])

  useEffect(() => {
    void reload()
  }, [reload])

  const patch = useCallback(
    async (authorityId: string, body: Record<string, unknown>): Promise<void> => {
      const response = await request(`${base}/authorities/${encodeURIComponent(authorityId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw await failure(response, "The change could not be saved.")
    },
    [base],
  )

  const saveAuthority = useCallback<CanonicalAuthorities["saveAuthority"]>(
    async (draft, editing) => {
      const kind = draft.canonicalKind
      if (!kind) throw new CanonicalOperationUnavailableError(`Saving ${draft.name || "this record"}`, NO_CANONICAL_KIND)

      // Fields with no canonical home must never be accepted and silently dropped.
      const noHome: string[] = []
      const original = editing?.record
      const same = (value: string, previous: string | undefined) => value.trim() === (previous ?? "").trim()
      if (draft.name.trim() !== (original?.name ?? kindDisplayName(kind))) noHome.push("Display Name")
      if (!same(draft.issuingAuthority, original?.issuingAuthority ?? (kind === "USDOT" || kind === "MC" ? "FMCSA" : ""))) noHome.push("Issuing Authority")
      if (draft.eventDate.trim()) noHome.push("Filed / Update Date")
      if (draft.nextActionDate.trim()) noHome.push("Next Action Date")
      if (!same(draft.notes, original?.notes)) noHome.push("Notes")
      if (original && draft.canonicalKind !== original.canonicalKind) noHome.push("Record Type (an existing record keeps its type)")
      if (noHome.length > 0) {
        throw new CanonicalOperationUnavailableError(
          "Saving " + noHome.join(", "),
          "these fields have no canonical home yet and would be lost. Clear or restore them to save the rest of the record.",
        )
      }

      const fixedRegion = kindFixedRegion(kind)
      const jurisdiction = jurisdictionToCanonical(kind, draft)
      if (!jurisdiction && !(kind === "USDOT" || kind === "MC")) throw new Error("Select the issuing jurisdiction.")
      if (!kindHasExpiry(kind) && draft.expiryDate.trim()) throw new Error(`${kind} records do not expire; clear the Expiry Date.`)

      const issuedOn = draft.issueDate.trim()
      const expiresOn = draft.expiryDate.trim()

      /* ------------------------------------------------------------------ create */
      if (!editing) {
        const payload: Record<string, unknown> = {
          kind,
          number: draft.number.trim(),
          status: STATUS_TO_CANONICAL[draft.status] ?? "ACTIVE",
        }
        if (jurisdiction) payload.jurisdiction = jurisdiction
        if (issuedOn) payload.issuedOn = issuedOn
        if (expiresOn) payload.expiresOn = expiresOn
        if (draft.effectiveDate.trim()) payload.effectiveFrom = `${draft.effectiveDate.trim()}T00:00:00Z`
        const response = await request(`${base}/authorities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
        if (!response.ok) throw await failure(response, "The authority could not be saved.")
        const created = (await response.json().catch(() => null))?.view as AuthorityView | undefined
        await reload()
        return created ? mapAuthorityView(created) : null
      }

      /* ------------------------------------------------------------------ edit: a real-world change vs a correction */
      const { record, mode } = editing
      if (record.isArchived) throw new Error("An archived record cannot be edited. Restore it first.")
      const changes: Record<string, unknown> = {}
      if (draft.number.trim() !== record.number) changes.number = draft.number.trim()
      if (jurisdiction && (draft.jurisdictionCode !== record.jurisdictionCode || (fixedRegion ? false : draft.country !== record.country))) changes.jurisdiction = jurisdiction
      if (issuedOn !== (record.issueDate ?? "")) changes.issuedOn = issuedOn || null
      if (expiresOn !== (record.expiryDate ?? "")) changes.expiresOn = expiresOn || null
      const effectiveChanged = draft.effectiveDate.trim() !== (record.effectiveDate ?? "")
      const wantsStatus = (STATUS_TO_CANONICAL[draft.status] ?? "") !== (STATUS_TO_CANONICAL[record.status] ?? "")

      if (mode === "correct" && effectiveChanged) {
        throw new CanonicalOperationUnavailableError("Correcting the Effective Date", "a correction replaces the recorded values but keeps the original effective time; record a real-world change to move the effective date.")
      }
      if (mode === "change" && kindNumberIsPermanent(kind) && "number" in changes) {
        throw new Error(`A ${kind} number does not change. If the recorded number was wrong, choose 'The recorded value was wrong' and correct it.`)
      }
      if (Object.keys(changes).length === 0 && !wantsStatus) throw new Error("Nothing was changed.")

      if (Object.keys(changes).length > 0) {
        const body: Record<string, unknown> = { ...changes, action: mode === "correct" ? "correctVersion" : "version" }
        if (mode === "change" && effectiveChanged && draft.effectiveDate.trim()) body.effectiveFrom = `${draft.effectiveDate.trim()}T00:00:00Z`
        await patch(record.id, body)
      }
      if (wantsStatus) {
        try {
          await patch(record.id, { action: mode === "correct" ? "correctStatus" : "status", status: STATUS_TO_CANONICAL[draft.status] })
        } catch (error) {
          await reload()
          const message = error instanceof Error ? error.message : "The status could not be saved."
          throw new Error(Object.keys(changes).length > 0 ? `The number and dates were saved, but the status was not: ${message}` : message)
        }
      }
      await reload()
      return null
    },
    [base, reload],
  )

  const archive = useCallback<CanonicalAuthorities["archive"]>(
    async (record, reason) => {
      if (reason.trim()) {
        throw new CanonicalOperationUnavailableError(
          "Recording an archive reason",
          "an archive reason has no canonical home yet, so it would be lost. Leave the reason empty to archive the record (it stays in the audit trail and can be restored).",
        )
      }
      await patch(record.id, { action: "archive" })
      await reload()
    },
    [patch, reload],
  )

  const restore = useCallback<CanonicalAuthorities["restore"]>(
    async (record) => {
      await patch(record.id, { action: "restore" })
      await reload()
    },
    [patch, reload],
  )

  const checkNumber = useCallback<CanonicalAuthorities["checkNumber"]>(
    async (draft) => {
      const kind = draft.canonicalKind
      if (!kind) throw new CanonicalOperationUnavailableError("Number check", NO_CANONICAL_KIND)
      if (!draft.number.trim()) throw new Error("Enter a number to check.")
      const jurisdiction = jurisdictionToCanonical(kind, draft)
      const response = await request(`${base}/authorities/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, number: draft.number.trim(), ...(jurisdiction ? { jurisdiction } : {}) }),
      })
      if (!response.ok) throw await failure(response, "The number could not be checked.")
      const result = (await response.json().catch(() => null)) as { registered?: boolean; match?: { organizationLegalName?: string } | null } | null
      if (!result?.registered) return "This number is not registered to any company."
      return result.match?.organizationLegalName ? `This number is already registered to ${result.match.organizationLegalName}.` : "This number is already registered (to this or another company)."
    },
    [base],
  )

  return useMemo(() => ({ state, company, records, reload, saveAuthority, archive, restore, checkNumber }), [state, company, records, reload, saveAuthority, archive, restore, checkNumber])
}
