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

export type RegistryPanelConfig = {
  section: string
  /** Path segment under /api/companies/[id]/ */
  resource: "authorities" | "tax-registrations"
  /** Key of the list in the GET payload and of the record in each view. */
  itemsKey: "authorities" | "registrations"
  itemKey: "authority" | "registration"
  typeField: "kind" | "program"
  typeLabel: string
  statusKey: "authorityStatus" | "registrationStatus"
  types: readonly string[]
  statuses: readonly string[]
  deferredNote: string
}

type Version = {
  recordStatus?: string
  effectiveFrom?: string
  effectiveTo?: string | null
  numberDisplay: string
  jurisdictionCountry: string
  jurisdictionRegion: string | null
  issuedOn: string | null
  expiresOn: string | null
}
type View = {
  current: { version: Version | null; status: Record<string, string> | null }
  versions?: Version[]
  statusPeriods?: Array<Record<string, string | null>>
} & Record<string, unknown>
type CompanyHeader = { id: string; name: string; kind: string; status: string }

export default function CanonicalRegistryPanel({ config }: { config: RegistryPanelConfig }) {
  const params = useParams()
  const companyId = params.id as string
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const [company, setCompany] = useState<CompanyHeader | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [items, setItems] = useState<View[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [profile, list] = await Promise.all([
        fetch(`${base}/profile`, { cache: "no-store" }),
        fetch(`${base}/${config.resource}`, { cache: "no-store" }),
      ])
      {
        const lookup = await readCompanyLookup<CompanyHeader>(profile)
        setCompany(lookup.company)
        setLookupFailed(lookup.failed)
      }
      if (list.ok) setItems((await list.json())[config.itemsKey] ?? [])
      else setError((await list.json().catch(() => null))?.error ?? "Unable to load records.")
    } catch {
      setError("Unable to load records.")
    } finally {
      setLoading(false)
    }
  }, [base, config.itemsKey, config.resource])

  useEffect(() => {
    void load()
  }, [load])

  async function send(url: string, method: "POST" | "PATCH", payload: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      if (!response.ok) {
        setError((await response.json().catch(() => null))?.error ?? "The change could not be saved.")
        return false
      }
      await load()
      return true
    } catch {
      setError("The change could not be saved.")
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const field = (name: string) => String(data.get(name) ?? "").trim()
    const payload: Record<string, unknown> = {
      [config.typeField]: field("type"),
      number: field("number"),
      status: field("status") || undefined,
      issuedOn: field("issuedOn") || undefined,
      expiresOn: field("expiresOn") || undefined,
    }
    if (field("region")) payload.jurisdiction = { region: field("region") }
    if (await send(`${base}/${config.resource}`, "POST", payload)) form.reset()
  }

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <CompanyMissing failed={lookupFailed} />

  return (
    <div className="flex flex-col gap-6 pb-10">
      <CompanyWorkspaceHeader company={company} section={config.section} />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b">
          <CardTitle className="text-sm">{config.section} on record</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No records yet.</p>
          ) : (
            <div className="flex flex-col divide-y">
              {items.map((view) => {
                const record = view[config.itemKey] as Record<string, string>
                const version = view.current.version
                const status = view.current.status?.[config.statusKey] ?? "—"
                const archived = record.recordStatus === "archived"
                return (
                  <div key={record.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {record[config.typeField]} — {version?.numberDisplay ?? "—"}
                        {archived ? " (archived)" : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {[version?.jurisdictionRegion, version?.jurisdictionCountry].filter(Boolean).join(", ")}
                        {version?.issuedOn ? ` · issued ${version.issuedOn}` : ""}
                        {version?.expiresOn ? ` · expires ${version.expiresOn}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{status}</span>
                      <select
                        aria-label="Change status"
                        className="rounded-md border bg-background px-2 py-1 text-xs"
                        value=""
                        disabled={busy || archived}
                        onChange={(event) => {
                          if (event.target.value) {
                            void send(`${base}/${config.resource}/${record.id}`, "PATCH", { action: "status", status: event.target.value })
                          }
                        }}
                      >
                        <option value="">Change status…</option>
                        {config.statuses.filter((value) => value !== status).map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void send(`${base}/${config.resource}/${record.id}`, "PATCH", { action: archived ? "restore" : "archive" })}
                      >
                        {archived ? "Restore" : "Archive"}
                      </Button>
                    </div>
                    {archived ? null : (
                      <details className="basis-full text-xs">
                        <summary className="cursor-pointer font-semibold">Edit or correct · history</summary>
                        <form
                          className="grid sm:grid-cols-5 gap-2 pt-2 items-end"
                          onSubmit={(event) => {
                            event.preventDefault()
                            const form = new FormData(event.currentTarget)
                            const f = (name: string) => String(form.get(name) ?? "").trim()
                            const payload: Record<string, unknown> = { action: f("mode") === "correct" ? "correctVersion" : "version" }
                            if (f("number") && f("number") !== (version?.numberDisplay ?? "")) payload.number = f("number")
                            if (f("region") && f("region") !== (version?.jurisdictionRegion ?? "")) payload.jurisdiction = { region: f("region") }
                            if (f("issuedOn") !== (version?.issuedOn ?? "")) payload.issuedOn = f("issuedOn") || null
                            if (f("expiresOn") !== (version?.expiresOn ?? "")) payload.expiresOn = f("expiresOn") || null
                            void send(`${base}/${config.resource}/${record.id}`, "PATCH", payload)
                          }}
                        >
                          <Input name="number" defaultValue={version?.numberDisplay ?? ""} aria-label="Number" />
                          <Input name="region" defaultValue={version?.jurisdictionRegion ?? ""} aria-label="Jurisdiction region" placeholder="Region" />
                          <Input name="issuedOn" type="date" defaultValue={version?.issuedOn ?? ""} aria-label="Issued" />
                          <Input name="expiresOn" type="date" defaultValue={version?.expiresOn ?? ""} aria-label="Expires" />
                          <Button type="submit" size="sm" disabled={busy}>Save</Button>
                          <label className="sm:col-span-5 flex items-center gap-2"><input type="radio" name="mode" value="change" defaultChecked /> A real-world change (the earlier version stays as history)</label>
                          <label className="sm:col-span-5 flex items-center gap-2"><input type="radio" name="mode" value="correct" /> The recorded value was wrong (correct it; the wrong one is kept and flagged)</label>
                        </form>
                        <div className="pt-2 flex items-center gap-2">
                          <span>Correct status</span>
                          <select
                            aria-label="Correct status"
                            className="rounded-md border bg-background px-2 py-1"
                            value=""
                            disabled={busy}
                            onChange={(event) => {
                              if (event.target.value) void send(`${base}/${config.resource}/${record.id}`, "PATCH", { action: "correctStatus", status: event.target.value })
                            }}
                          >
                            <option value="">The status was recorded wrongly…</option>
                            {config.statuses.filter((value) => value !== status).map((value) => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          </select>
                        </div>
                        <ul className="pt-2 list-disc pl-5 text-muted-foreground" aria-label="Version history">
                          {(view.versions ?? []).map((v, index) => (
                            <li key={`${v.numberDisplay}-${v.effectiveFrom ?? index}`}>
                              {v.numberDisplay}
                              {[v.jurisdictionRegion, v.jurisdictionCountry].filter(Boolean).length ? ` · ${[v.jurisdictionRegion, v.jurisdictionCountry].filter(Boolean).join(", ")}` : ""}
                              {v.effectiveFrom ? ` · from ${v.effectiveFrom.slice(0, 10)}` : ""}
                              {v.effectiveTo ? ` to ${v.effectiveTo.slice(0, 10)}` : ""}
                              {v.recordStatus === "corrected" ? " · corrected (not genuine history)" : ""}
                            </li>
                          ))}
                        </ul>
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
          <CardTitle className="text-sm">Add {config.section.toLowerCase()} record</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleCreate} className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="type">{config.typeLabel}</Label>
              <select id="type" name="type" required className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                {config.types.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="number">Number</Label>
              <Input id="number" name="number" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="region">Jurisdiction (region code)</Label>
              <Input id="region" name="region" placeholder="e.g. ON" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="issuedOn">Issued</Label>
              <Input id="issuedOn" name="issuedOn" type="date" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="expiresOn">Expires</Label>
              <Input id="expiresOn" name="expiresOn" type="date" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="status">Initial status</Label>
              <select id="status" name="status" defaultValue="ACTIVE" className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                {config.statuses.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3 flex justify-end">
              <Button type="submit" disabled={busy}>Save record</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{config.deferredNote}</p>
    </div>
  )
}
