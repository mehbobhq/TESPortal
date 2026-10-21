"use client"


import { CompanyMissing } from "@/components/company-missing"
import { readCompanyLookup } from "@/lib/company-lookup"
import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const FAMILY_COVERAGES: Record<string, string[]> = {
  INSURANCE: ["AUTO_LIABILITY", "MOTOR_TRUCK_CARGO", "GENERAL_LIABILITY", "PHYSICAL_DAMAGE", "UMBRELLA_EXCESS", "REEFER_BREAKDOWN"],
  WORKERS_COMPENSATION: ["WORKERS_COMPENSATION"],
  BOND: ["BOND_FREIGHT_BROKER", "BOND_CUSTOMS", "BOND_PERFORMANCE"],
}
const LIMIT_BASES = ["COMBINED_SINGLE_LIMIT", "PER_OCCURRENCE", "PER_VEHICLE", "AGGREGATE", "PENAL_SUM"]

type Coverage = { id: string; coverageType: string; limitAmount: string | null; currency: string | null; limitBasis?: string | null; deductibleAmount?: string | null }
type Term = { id: string; numberDisplay: string; termStart: string; termEnd: string | null; cancelledOn: string | null }
type Policy = {
  policy: { id: string; insurerOrganizationId: string; family: string; recordStatus: string }
  terms?: Array<{ coverages: Coverage[] }>
  asOf: { inForce: boolean; term: Term | null; coverages: Coverage[] }
  current: { latestTerm: Term | null }
}
type Company = { id: string; name: string; kind: string; status: string }
type Directory = { id: string; name: string }

/**
 * The canonical (PostgreSQL-backed) Insurance workspace. Kept intact (mechanical export change only) but NOT rendered by the Insurance route
 * (see ./page.tsx) and not a route itself. Its API, services, tables and records are unchanged. Re-mounting it is a deliberate product decision.
 */
export function CanonicalInsurance() {
  const params = useParams()
  const companyId = params.id as string
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const [company, setCompany] = useState<Company | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [policies, setPolicies] = useState<Policy[]>([])
  const [directory, setDirectory] = useState<Directory[]>([])
  const [family, setFamily] = useState("INSURANCE")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [profile, list, companies] = await Promise.all([
        fetch(`${base}/profile`, { cache: "no-store" }),
        fetch(`${base}/insurance`, { cache: "no-store" }),
        fetch("/api/companies", { cache: "no-store" }),
      ])
      {
          const lookup = await readCompanyLookup<Company>(profile)
          setCompany(lookup.company)
          setLookupFailed(lookup.failed)
        }
      if (list.ok) setPolicies((await list.json()).policies ?? [])
      else setError((await list.json().catch(() => null))?.error ?? "Unable to load insurance.")
      if (companies.ok) setDirectory(((await companies.json()).companies ?? []) as Directory[])
    } catch {
      setError("Unable to load insurance.")
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  async function patch(policyId: string, payload: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`${base}/insurance/${policyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) setError((await response.json().catch(() => null))?.error ?? "The change could not be saved.")
      else await load()
    } catch {
      setError("The change could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const field = (name: string) => String(data.get(name) ?? "").trim()
    const coverage: Record<string, unknown> = { coverageType: field("coverageType") }
    if (field("limitAmount")) coverage.limitAmount = field("limitAmount")
    if (field("deductibleAmount")) coverage.deductibleAmount = field("deductibleAmount")
    if (field("currency")) coverage.currency = field("currency")
    if (field("limitBasis")) coverage.limitBasis = field("limitBasis")
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`${base}/insurance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          insurerOrganizationId: field("insurer"),
          family,
          policyNumber: field("policyNumber"),
          termStart: field("termStart"),
          termEnd: field("termEnd") || null,
          coverages: [coverage],
        }),
      })
      if (!response.ok) setError((await response.json().catch(() => null))?.error ?? "The policy could not be saved.")
      else {
        form.reset()
        await load()
      }
    } catch {
      setError("The policy could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <CompanyMissing failed={lookupFailed} />

  const nameOf = (id: string) => directory.find((entry) => entry.id === id)?.name ?? id

  return (
    <div className="flex flex-col gap-6 pb-10">
      <CompanyWorkspaceHeader company={company} section="Insurance" />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b">
          <CardTitle className="text-sm">Policies on record</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {policies.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No policies yet.</p>
          ) : (
            <div className="flex flex-col divide-y">
              {policies.map((view) => {
                const term = view.current.latestTerm
                const archived = view.policy.recordStatus === "archived"
                // A renewal starts from the most recent term's coverage (what is in force today may be empty once a term has ended).
                const priorCoverages = view.terms?.[view.terms.length - 1]?.coverages?.length ? view.terms[view.terms.length - 1].coverages : view.asOf.coverages
                return (
                  <div key={view.policy.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {nameOf(view.policy.insurerOrganizationId)} — {term?.numberDisplay ?? "—"}
                        {archived ? " (archived)" : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {view.policy.family}
                        {term ? ` · ${term.termStart} to ${term.termEnd ?? "continuous"}` : ""}
                        {term?.cancelledOn ? ` · cancelled ${term.cancelledOn}` : ""}
                        {view.asOf.inForce ? " · in force" : " · not in force"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {view.asOf.coverages
                          .map((c) => `${c.coverageType}${c.limitAmount ? ` ${c.currency ?? ""} ${c.limitAmount}` : ""}`)
                          .join("; ")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void patch(view.policy.id, { action: archived ? "restore" : "archive" })}
                    >
                      {archived ? "Restore" : "Archive"}
                    </Button>
                    {archived || !term ? null : (
                      <details className="basis-full text-xs">
                        <summary className="cursor-pointer font-semibold">Renew or cancel this policy</summary>
                        <div className="grid md:grid-cols-2 gap-4 pt-2">
                          <form
                            className="grid grid-cols-2 gap-2 items-end"
                            onSubmit={(event) => {
                              event.preventDefault()
                              const form = new FormData(event.currentTarget)
                              const f = (name: string) => String(form.get(name) ?? "").trim()
                              const first = priorCoverages[0]
                              void patch(view.policy.id, {
                                action: "renew",
                                termStart: f("termStart"),
                                termEnd: f("termEnd") || null,
                                ...(f("policyNumber") ? { policyNumber: f("policyNumber") } : {}),
                                coverages: [{ coverageType: f("coverageType"), limitAmount: f("limitAmount"), currency: f("currency"), ...(first?.limitBasis ? { limitBasis: first.limitBasis } : {}) }],
                              })
                            }}
                          >
                            <label className="space-y-1">New term starts<Input name="termStart" type="date" required defaultValue={term.termEnd ?? ""} /></label>
                            <label className="space-y-1">New term ends<Input name="termEnd" type="date" /></label>
                            <label className="space-y-1">New policy number (blank keeps it)<Input name="policyNumber" /></label>
                            <label className="space-y-1">Coverage type<Input name="coverageType" required defaultValue={priorCoverages[0]?.coverageType ?? ""} /></label>
                            <label className="space-y-1">Limit<Input name="limitAmount" defaultValue={priorCoverages[0]?.limitAmount ?? ""} /></label>
                            <label className="space-y-1">Currency<Input name="currency" defaultValue={priorCoverages[0]?.currency ?? "CAD"} /></label>
                            <Button type="submit" size="sm" disabled={busy} className="col-span-2">Renew (new term, history kept)</Button>
                          </form>
                          <form
                            className="grid grid-cols-2 gap-2 items-end"
                            onSubmit={(event) => {
                              event.preventDefault()
                              const form = new FormData(event.currentTarget)
                              void patch(view.policy.id, { action: "cancel", termId: term.id, cancelledOn: String(form.get("cancelledOn") ?? ""), reason: String(form.get("reason") ?? "") })
                            }}
                          >
                            <label className="space-y-1">Cancelled on<Input name="cancelledOn" type="date" required /></label>
                            <label className="space-y-1">Reason
                              <select name="reason" required className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                                {["INSURED_REQUEST", "INSURER_CANCELLATION", "NON_PAYMENT", "REPLACED_BY_NEW_POLICY"].map((value) => <option key={value}>{value}</option>)}
                              </select>
                            </label>
                            <Button type="submit" size="sm" variant="outline" disabled={busy || Boolean(term.cancelledOn)} className="col-span-2">Cancel this term</Button>
                          </form>
                        </div>
                      </details>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b">
          <CardTitle className="text-sm">Add policy</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleCreate} className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="insurer">Insurer / carrier (company record)</Label>
              <select id="insurer" name="insurer" required className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                <option value="">Select…</option>
                {directory.filter((entry) => entry.id !== companyId).map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="family">Family</Label>
              <select
                id="family"
                value={family}
                onChange={(event) => setFamily(event.target.value)}
                className="w-full rounded-md border bg-background px-2 py-2 text-sm"
              >
                {Object.keys(FAMILY_COVERAGES).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="policyNumber">Policy number</Label>
              <Input id="policyNumber" name="policyNumber" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="termStart">Term start</Label>
              <Input id="termStart" name="termStart" type="date" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="termEnd">Term end</Label>
              <Input id="termEnd" name="termEnd" type="date" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="coverageType">Coverage</Label>
              <select id="coverageType" name="coverageType" required className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                {FAMILY_COVERAGES[family].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="limitAmount">Limit</Label>
              <Input id="limitAmount" name="limitAmount" inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deductibleAmount">Deductible</Label>
              <Input id="deductibleAmount" name="deductibleAmount" inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="currency">Currency</Label>
              <select id="currency" name="currency" className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                <option value="">—</option>
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="limitBasis">Limit basis</Label>
              <select id="limitBasis" name="limitBasis" className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                <option value="">—</option>
                {LIMIT_BASES.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3 flex justify-end">
              <Button type="submit" disabled={busy}>Save policy</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Certificates, certificate evidence and OCR intake are deferred: they have no canonical PostgreSQL storage yet.
      </p>
    </div>
  )
}
