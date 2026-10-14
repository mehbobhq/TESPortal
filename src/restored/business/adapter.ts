"use client"

/**
 * Canonical adapter for the restored Business & Corporate Records workspace.
 *
 * It maps the canonical corporate-identity records (organization_identifiers: INCORPORATION, CRA_BN, IRS_EIN, including the
 * superseded ones as history) onto the shapes the ORIGINAL Business components expect, and implements their callbacks through
 * the canonical routes. Nothing is stored in the browser. A control whose data has no canonical home keeps its place and
 * refuses with an explicit "not available" message that names the gap (see `unavailable`); it never pretends to save.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import type { BusinessTaxAccountRecord } from "@/src/types/business"

export type ProfileForBusiness = {
  id: string
  name: string
  legalName: string
  kind: string
  status: string
  opRegion: "Canada Only" | "US Only" | "Cross-Border" | null
  regCorpState: string | null
  regCorpCountry: string | null
  incorpNo: string | null
  businessNo: string | null
  ein: string | null
}

export type CanonicalIdentifier = {
  id: string
  kind: "INCORPORATION" | "CRA_BN" | "IRS_EIN"
  value: string
  status: "active" | "superseded"
  recordedAt: string
  supersededAt: string | null
}

type BusinessResponse = { business: { organizationId: string; formationCountry: string | null; formationRegion: string | null; identifiers: CanonicalIdentifier[] } }

/** The original tax-account record plus the one date the canonical record really has. */
export type CanonicalTaxRecord = BusinessTaxAccountRecord & { recordedAt: string }

/** The company shape the original Business components read (they were written against the browser company master). */
export type BusinessCompany = {
  id: string
  name: string
  legalName: string
  kind: string
  status: string
  region: string
  regCorpState: string
  regCorpCountry: string
  incorpNo: string
  businessNo: string
  ein: string
  /** No canonical column holds an incorporation date, so it is never invented. */
  incorpDate: string
}

export const unavailable = {
  incorporationDate: () =>
    new CanonicalOperationUnavailableError("Saving the incorporation date", "no canonical column holds an incorporation date yet (it needs a decision on where it belongs). The incorporation NUMBER and jurisdiction are managed on Edit."),
  shareholders: () =>
    new CanonicalOperationUnavailableError("Saving directors and shareholders", "no canonical record holds ownership percentages (people and titles belong to Contacts; ownership has no domain yet), so nothing was saved."),
  annualReturns: () => new CanonicalOperationUnavailableError("Saving annual returns", "no canonical record holds corporate annual returns yet, so nothing was saved."),
  gst: () =>
    new CanonicalOperationUnavailableError("Saving a GST/HST program account", "tax registration programs have no GST/HST program, and a program account is not a Business Number root. Nothing was saved."),
  salesTax: () => new CanonicalOperationUnavailableError("Saving a state sales-tax registration", "no canonical registration program or family covers state sales tax. Nothing was saved."),
  restoreNumber: () =>
    new CanonicalOperationUnavailableError("Restoring a retired number", "a retired (superseded) number stays as history and cannot be reactivated. Register it again if it is the current one."),
  obtained: () => new CanonicalOperationUnavailableError("Obtained date and obtained by", "no canonical column records them; the date this number was recorded in TES is shown instead."),
  recordDetails: () =>
    new CanonicalOperationUnavailableError("Saving record details", "the evidence record keeps its title, file and status only; classification, registry, reference, effective date and notes have no canonical fields."),
  registryRequest: () => new CanonicalOperationUnavailableError("Request from Registry", "no canonical record tracks registry requests, so nothing was recorded."),
  ocr: () => new CanonicalOperationUnavailableError("Run OCR", "legacy document OCR is closed; no approved OCR path exists for corporate papers."),
  reviewedFacts: () => new CanonicalOperationUnavailableError("Confirm reviewed facts", "no canonical record holds source-reviewed corporate facts."),
  auditCase: () => new CanonicalOperationUnavailableError("Creating an audit case", "carrier audit cases have no canonical domain (no table), so nothing was saved."),
}

async function call<T>(url: string, init?: { method: string; body: unknown }): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...(init ? { method: init.method, headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "The request was refused.")
  return body as T
}

const day = (iso: string) => iso.slice(0, 10)

export function toTaxRecords(identifiers: CanonicalIdentifier[], kind: "CRA_BN" | "IRS_EIN"): CanonicalTaxRecord[] {
  const same = identifiers.filter((item) => item.kind === kind).sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))
  const firstActive = same.find((item) => item.status === "active")
  return same.map((item) => ({
    id: item.id,
    taxType: kind,
    jurisdiction: kind === "CRA_BN" ? "Federal (Canada)" : "Federal (US)",
    accountNo: item.value,
    rootBN: kind === "CRA_BN" ? item.value : undefined,
    obtainedDate: day(item.recordedAt),
    obtainedBy: "",
    isPrimary: item.id === firstActive?.id,
    isArchived: item.status === "superseded",
    archivedAt: item.supersededAt ?? undefined,
    recordedAt: item.recordedAt,
  }))
}

export function toBusinessCompany(profile: ProfileForBusiness): BusinessCompany {
  return {
    id: profile.id,
    name: profile.name,
    legalName: profile.legalName,
    kind: profile.kind,
    status: profile.status,
    region: profile.opRegion ?? "",
    regCorpState: profile.regCorpState ?? "",
    regCorpCountry: profile.regCorpCountry ?? "",
    incorpNo: profile.incorpNo ?? "",
    businessNo: profile.businessNo ?? "",
    ein: profile.ein ?? "",
    incorpDate: "",
  }
}

export function useCanonicalBusiness(companyId: string, initialProfile: ProfileForBusiness) {
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const [profile, setProfile] = useState<ProfileForBusiness>(initialProfile)
  const [identifiers, setIdentifiers] = useState<CanonicalIdentifier[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    const [business, fresh] = await Promise.allSettled([call<BusinessResponse>(`${base}/business`), call<{ company: ProfileForBusiness }>(`${base}/profile`)])
    if (!alive.current) return
    if (business.status === "fulfilled") {
      setIdentifiers(business.value.business.identifiers)
      setLoadError(null)
    } else {
      setLoadError(business.reason instanceof Error ? business.reason.message : "Unable to load business records.")
    }
    if (fresh.status === "fulfilled") setProfile(fresh.value.company)
    setLoading(false)
  }, [base])

  useEffect(() => {
    alive.current = true
    void reload()
    return () => {
      alive.current = false
    }
  }, [reload])

  return {
    profile,
    company: toBusinessCompany(profile),
    identifiers,
    craRecords: toTaxRecords(identifiers, "CRA_BN"),
    einRecords: toTaxRecords(identifiers, "IRS_EIN"),
    loading,
    loadError,

    /** Registers a CRA BN / EIN. `relation` is required (and only used) when one is already active. */
    registerNumber: async (kind: "CRA_BN" | "IRS_EIN", value: string, relation?: "change" | "correction") => {
      await call(`${base}/business`, { method: "POST", body: { kind, value, ...(relation ? { relation } : {}) } })
      await reload()
    },
    /** Ends a number as history (never a delete). */
    retireNumber: async (identifierId: string) => {
      await call(`${base}/business`, { method: "PATCH", body: { action: "retire", identifierId } })
      await reload()
    },
  }
}

export type CanonicalBusiness = ReturnType<typeof useCanonicalBusiness>
