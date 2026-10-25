"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { CompanyMissing } from "@/components/company-missing"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { readCompanyLookup } from "@/lib/company-lookup"
import { DETAILED_WIZARD_CATEGORIES } from "@/lib/driver-events/workflows"
import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY, PERFORMANCE_CATEGORY_OWNERSHIP } from "@/lib/driver-performance-schema"
import { EVENT_STATUSES } from "@/lib/driver-events/operations-constants"
import type { DriverPerformanceEvent } from "@/types/drivers"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { CategoryEventForm } from "./category-form"
import { EventDetail } from "./event-detail"
import { eventsApi, type DriverOption, type EventRow, type VehicleOption } from "./events-api"
import { inputClass } from "./field-input"
import { DetailedWizardHost } from "./wizard-host"

type Company = { id: string; name: string; kind: string; status: string }
type View = { kind: "list" } | { kind: "choose" } | { kind: "detail"; id: string } | { kind: "form"; code: string } | { kind: "wizard"; category: DriverPerformanceEvent["eventType"] }

const recordable = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.filter((d) => PERFORMANCE_CATEGORY_OWNERSHIP[d.value] === "RECORDABLE_EVENT")
const human = (v: string) => v.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase())

export function EventsWorkspace() {
  const params = useParams()
  const companyId = params.id as string
  const api = useMemo(() => eventsApi(companyId), [companyId])
  const [company, setCompany] = useState<Company | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<EventRow[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: "list" })
  const [filters, setFilters] = useState({ category: "", status: "" })

  const reload = useCallback(async () => {
    try {
      const f: Record<string, string> = {}
      if (filters.category) f.category = filters.category
      if (filters.status) f.status = filters.status
      setEvents(await api.list(f)); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load events.") }
  }, [api, filters])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const lookup = await readCompanyLookup<Company>(await fetch(`/api/companies/${encodeURIComponent(companyId)}/profile`, { cache: "no-store" }))
        if (cancelled) return
        setCompany(lookup.company); setLookupFailed(lookup.failed)
        // Reference lists are best-effort: a staff member without driver/vehicle read still sees events.
        await Promise.all([api.drivers().then((d) => !cancelled && setDrivers(d)).catch(() => undefined), api.vehicles().then((v) => !cancelled && setVehicles(v)).catch(() => undefined)])
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [api, companyId])
  useEffect(() => { void reload() }, [reload])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <CompanyMissing failed={lookupFailed} />

  const saved = (id: string, n?: string) => { setNotice(n ?? "Event recorded."); void reload(); setView({ kind: "detail", id }) }
  const groups = [...new Set(recordable.map((d) => d.group))]

  return (
    <div className="flex flex-col gap-6 pb-10" data-testid="record-of-events">
      <CompanyWorkspaceHeader
        company={company}
        section="Record of Events"
        description="Driver events: collisions, inspections, incidents, observations and customer events, recorded once and linked to the company's own drivers and vehicles"
        actions={view.kind === "list" ? <Button onClick={() => setView({ kind: "choose" })}>Record event</Button> : undefined}
      />
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {notice && view.kind !== "list" ? <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs">{notice}</p> : null}

      {view.kind === "list" ? (
        <Card>
          <CardHeader className="border-b bg-muted/30 py-3"><CardTitle className="text-sm">Events on record</CardTitle></CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div className="flex flex-wrap gap-2">
              <select aria-label="Filter by category" className={`${inputClass} w-56`} value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
                <option value="">All categories</option>{recordable.map((d) => <option key={d.code} value={d.value}>{d.label}</option>)}
              </select>
              <select aria-label="Filter by status" className={`${inputClass} w-48`} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">All statuses</option>{EVENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            {events.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No events recorded yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead><tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground"><th className="py-2 pr-3">Event</th><th className="pr-3">Category</th><th className="pr-3">Occurred</th><th className="pr-3">Status</th><th>Flags</th></tr></thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id} className="cursor-pointer border-b hover:bg-muted/30" onClick={() => setView({ kind: "detail", id: e.id })} data-testid="event-row">
                        <td className="py-2 pr-3 font-semibold text-primary">{e.title}</td>
                        <td className="pr-3">{e.category}</td>
                        <td className="pr-3">{e.occurrence_precision === "EXACT_DATETIME" && e.occurred_at ? new Date(e.occurred_at).toLocaleString() : `${String(e.occurred_local_date ?? "").slice(0, 10) || "—"} (${human(e.occurrence_precision)})`}</td>
                        <td className="pr-3">{e.status}{e.record_state === "DRAFT" ? " · Draft" : ""}</td>
                        <td>{e.active_restrictions ? <span className="font-semibold text-destructive">Restricted</span> : null}{e.is_duplicate ? <span className="text-muted-foreground"> Duplicate</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view.kind === "choose" ? (
        <div className="space-y-5" data-testid="category-chooser">
          <div className="flex items-center justify-between"><h2 className="text-base font-bold">What kind of event?</h2><Button variant="outline" onClick={() => setView({ kind: "list" })}>Cancel</Button></div>
          {groups.map((g) => (
            <section key={g}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{g}</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {recordable.filter((d) => d.group === g).map((d) => {
                  const detailed = (DETAILED_WIZARD_CATEGORIES as readonly string[]).includes(d.value)
                  return (
                    <button key={d.code} type="button" data-category={d.code} onClick={() => setView(detailed ? { kind: "wizard", category: d.value } : { kind: "form", code: d.code })} className="rounded-xl border border-border p-3 text-left hover:border-primary/40 hover:bg-muted/20">
                      <span className="flex items-center justify-between gap-2 text-xs font-bold">{d.label}{detailed ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] text-primary">Detailed workflow</span> : null}</span>
                      <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{d.description}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {view.kind === "form" ? (
        <div className="space-y-3">
          <h2 className="text-base font-bold">{recordable.find((d) => d.code === view.code)?.label}</h2>
          <CategoryEventForm companyId={companyId} code={view.code} drivers={drivers} vehicles={vehicles} onCancel={() => setView({ kind: "choose" })} onSaved={saved} />
        </div>
      ) : null}

      {view.kind === "wizard" ? <DetailedWizardHost companyId={companyId} category={view.category} drivers={drivers} vehicles={vehicles} onCancel={() => setView({ kind: "choose" })} onSaved={saved} /> : null}

      {view.kind === "detail" ? (
        <EventDetail companyId={companyId} eventId={view.id} drivers={drivers} vehicles={vehicles} onBack={() => { setNotice(null); setView({ kind: "list" }); void reload() }} onChanged={() => void reload()} />
      ) : null}
    </div>
  )
}
