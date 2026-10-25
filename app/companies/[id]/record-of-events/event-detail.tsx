"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { TESDateField } from "@/components/ui/tes-date-field"
import { CONSEQUENCE_KINDS, EVENT_RELATIONSHIPS, EVENT_STATUSES, EVIDENCE_ROLES, ACTION_TYPES } from "@/lib/driver-events/operations-constants"
import { CATEGORY_WORKFLOWS } from "@/lib/driver-events/workflows"
import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY } from "@/lib/driver-performance-schema"
import { CategoryEventForm, type CorrectionSeed } from "./category-form"
import { EventsApiError, eventsApi, type DriverOption, type VehicleOption } from "./events-api"
import { inputClass, Label } from "./field-input"

type Any = Record<string, any>
const human = (v: string) => v.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase())
const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "—")

function Card({ title, tone, children, testId }: { title: string; tone?: "danger"; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className={`rounded-2xl border p-4 ${tone === "danger" ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}
const Pill = ({ children, tone }: { children: React.ReactNode; tone?: "warn" | "ok" | "bad" }) => (
  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone === "bad" ? "border-destructive/40 text-destructive" : tone === "ok" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : tone === "warn" ? "border-amber-500/50 text-amber-700 dark:text-amber-400" : "border-border text-muted-foreground"}`}>{children}</span>
)

export function EventDetail({ companyId, eventId, drivers, vehicles, onBack, onChanged }: { companyId: string; eventId: string; drivers: DriverOption[]; vehicles: VehicleOption[]; onBack: () => void; onChanged: () => void }) {
  const api = useMemo(() => eventsApi(companyId), [companyId])
  const [data, setData] = useState<Any | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [correcting, setCorrecting] = useState(false)

  const load = useCallback(async () => {
    try { setData(await api.get(eventId)); setError(null) } catch (e) { setError(e instanceof Error ? e.message : "Unable to load the event.") }
  }, [api, eventId])
  useEffect(() => { void load() }, [load])

  /** Runs one mutation, then reloads: the page always shows what the server holds. */
  async function run(work: () => Promise<unknown>, done?: string) {
    setError(null); setNotice(null)
    try { await work(); await load(); onChanged(); if (done) setNotice(done) } catch (e) { setError(e instanceof EventsApiError || e instanceof Error ? e.message : "The change could not be saved.") }
  }

  if (!data) return <p className="p-6 text-sm text-muted-foreground">{error ?? "Loading…"}</p>
  const e = data.event as Any
  const definition = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.find((d) => d.code === e.category_code)!
  const workflow = CATEGORY_WORKFLOWS[e.category_code]
  const activeRestrictions = (data.restrictions as Any[]).filter((r) => r.state === "ACTIVE")
  const fieldByKey = new Map(definition.fields.map((f) => [f.key, f]))
  const record = e.record as Any

  if (correcting) {
    const seed: CorrectionSeed = {
      id: e.id, version: e.current_version,
      preserved: { tripReference: e.trip_reference ?? null, reporterLabel: e.reporter_label ?? null, subtype: e.subtype ?? null, ingestionOrigin: e.ingestion_origin, reportedAt: e.reported_at ? new Date(e.reported_at).toISOString() : null, latitude: e.latitude === null || e.latitude === undefined ? null : Number(e.latitude), longitude: e.longitude === null || e.longitude === undefined ? null : Number(e.longitude) },
      facts: record.facts ?? {}, factStates: record.factStates ?? {}, factUnits: record.factUnits ?? {}, childCollections: record.childCollections ?? {},
      header: {
        title: e.title, narrative: e.narrative ?? "", date: e.occurred_local_date ? String(e.occurred_local_date).slice(0, 10) : "", time: e.occurred_local_time ? String(e.occurred_local_time).slice(0, 5) : "",
        timeZone: e.occurred_time_zone ?? undefined, approximate: e.occurrence_precision === "APPROXIMATE", reportedDate: e.reported_local_date ? String(e.reported_local_date).slice(0, 10) : "", sourceType: e.source_type,
        sourceReference: e.source_reference ?? "", driver: e.driver_relationship_id ?? "", vehicle: e.vehicle_relationship_id ?? "", trailer: e.trailer_relationship_id ?? "", loadReference: e.load_reference ?? "",
        shipmentReference: e.shipment_reference ?? "", customerReference: e.customer_reference ?? "", locationText: e.location_text ?? "", city: e.city ?? "", stateProvince: e.state_province ?? "",
        country: e.country ?? "", jurisdictionCode: e.jurisdiction_code ?? "", severity: e.observed_severity, potentialSeverity: e.potential_severity ?? "",
      },
    }
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold">Correct: {e.title}</h2>
        <CategoryEventForm companyId={companyId} code={e.category_code} drivers={drivers} vehicles={vehicles} seed={seed} onCancel={() => setCorrecting(false)} onSaved={async (_id, n) => { setCorrecting(false); await load(); onChanged(); setNotice(n ?? "Correction saved.") }} />
      </div>
    )
  }

  return (
    <div className="space-y-5" data-testid="event-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="text-xs font-semibold text-primary hover:underline">← All events</button>
          <h2 className="mt-1 text-lg font-bold text-foreground">{e.title}</h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Pill>{e.category}</Pill><Pill tone={e.status === "Closed" ? "ok" : undefined}>{e.status}</Pill>{e.record_state === "DRAFT" ? <Pill tone="warn">Draft</Pill> : null}
            <Pill>{e.observed_severity}</Pill><Pill tone={e.verification_state === "VERIFIED" ? "ok" : "warn"}>{human(e.verification_state)}</Pill><Pill>Version {e.current_version}</Pill>
            {activeRestrictions.length ? <Pill tone="bad">{activeRestrictions.length} active restriction{activeRestrictions.length > 1 ? "s" : ""}</Pill> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {e.occurrence_precision === "EXACT_DATETIME" ? `${when(e.occurred_at)} (${e.occurred_time_zone})` : `${String(e.occurred_local_date ?? "").slice(0, 10) || "Date unknown"} · ${human(e.occurrence_precision)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {e.status !== "Closed" ? <Button size="sm" variant="outline" onClick={() => setCorrecting(true)}>{e.record_state === "DRAFT" ? "Edit draft" : "Correct record"}</Button> : null}
        </div>
      </div>
      {error ? <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
      {notice ? <div role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs">{notice}</div> : null}

      <Restrictions api={api} eventId={eventId} data={data} run={run} />

      <Card title="Facts recorded">
        {workflow ? <p className="text-[11px] text-muted-foreground">{workflow.boundary}</p> : null}
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {Object.entries(record.facts ?? {}).map(([k, v]) => {
            const f = fieldByKey.get(k)
            const option = f?.options?.find((o) => o.value === v)
            return (
              <div key={k}><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{f?.label ?? k}</dt><dd className="text-xs font-medium">{option?.label ?? String(v)}{record.factUnits?.[k] ? ` ${record.factUnits[k]}` : f?.unit ? ` ${f.unit}` : ""}</dd></div>
            )
          })}
          {Object.entries(record.factStates ?? {}).filter(([, s]) => s !== "PROVIDED").map(([k, s]) => (
            <div key={`s-${k}`}><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{fieldByKey.get(k)?.label ?? k}</dt><dd className="text-xs italic text-muted-foreground">{human(String(s))}</dd></div>
          ))}
        </dl>
        {e.narrative ? <p className="whitespace-pre-wrap text-xs">{e.narrative}</p> : null}
        {Object.keys(record.childCollections ?? {}).length ? (
          <p className="text-[11px] text-muted-foreground">Detail records: {Object.entries(record.childCollections).map(([id, c]: [string, any]) => `${id.split(".").slice(-1)[0].toLowerCase().replace(/_/g, " ")} (${c.items?.length ?? 0})`).join(", ")}</p>
        ) : null}
      </Card>

      <Evidence api={api} eventId={eventId} data={data} run={run} workflowRoles={workflow?.evidenceRoles} />
      <Consequences api={api} eventId={eventId} data={data} run={run} suggested={workflow?.consequenceKinds} />
      <Actions api={api} eventId={eventId} data={data} run={run} />
      <Relationships api={api} eventId={eventId} data={data} run={run} />
      <Status api={api} eventId={eventId} e={e} run={run} />
      <Analytical fact={data.fact} />

      <Card title="History (immutable)" testId="history">
        <ol className="space-y-2">
          {(data.history as Any[]).map((h) => (
            <li key={h.id} className="text-xs"><span className="font-semibold">{human(h.entry_type)}</span>{h.record_version ? ` · v${h.record_version}` : ""} · <span className="text-muted-foreground">{when(h.occurred_at)}</span>
              {h.reason ? <span className="block text-muted-foreground">Reason: {h.reason}</span> : null}
              {(h.changes as Any[]).slice(0, 6).map((c, i) => <span key={i} className="block text-[11px] text-muted-foreground">{String(c.field)}{c.before !== undefined ? `: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}` : c.after !== undefined ? `: ${JSON.stringify(c.after)}` : ""}</span>)}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  )
}

type PanelProps = { api: ReturnType<typeof eventsApi>; eventId: string; data: Any; run: (work: () => Promise<unknown>, done?: string) => Promise<void> }

function Restrictions({ api, eventId, data, run }: PanelProps) {
  const list = data.restrictions as Any[]
  const evidence = (data.evidence as Any[]).filter((l) => l.link_status === "active" && l.role === "RELEASE_EVIDENCE")
  const [open, setOpen] = useState<string | null>(null)
  const [basis, setBasis] = useState("AUTHORITY_RELEASE_DOCUMENTED")
  const [doc, setDoc] = useState("")
  const [summary, setSummary] = useState("")
  if (!list.length) return null
  return (
    <Card title="Safety restrictions" tone={list.some((r) => r.state === "ACTIVE") ? "danger" : undefined} testId="restrictions">
      <p className="text-[11px] text-muted-foreground">A mandatory restriction is not cleared by changing the status or correcting an answer. It ends only with a documented release.</p>
      {list.map((r) => (
        <div key={r.id} className="rounded-xl border border-border bg-background p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{human(r.restriction_kind)}</span><Pill tone={r.state === "ACTIVE" ? "bad" : "ok"}>{r.state === "ACTIVE" ? "Active" : "Released"}</Pill><Pill>{human(r.authority)}</Pill>{r.mandatory ? <Pill>Mandatory</Pill> : null}</div>
          {r.required_correction ? <p className="mt-1 text-muted-foreground">Required: {r.required_correction}</p> : null}
          {r.response_deadline ? <p className="text-muted-foreground">Response deadline (as stated on the order): {String(r.response_deadline).slice(0, 10)}</p> : null}
          {r.state === "RELEASED" ? <p className="mt-1">Released {when(r.released_at)} · {human(r.release_basis)} · {r.correction_summary}</p> : null}
          {r.state === "ACTIVE" ? (
            open === r.id ? (
              <div className="mt-3 space-y-2">
                <div><Label htmlFor="rel-basis">Release basis</Label>
                  <select id="rel-basis" className={inputClass} value={basis} onChange={(e) => setBasis(e.target.value)}>
                    <option value="AUTHORITY_RELEASE_DOCUMENTED">Authority release documented</option>
                    <option value="CORRECTED_AND_AUTHORITY_CONFIRMED">Corrected and authority confirmed</option>
                    {r.authority === "COMPANY" || r.authority === "OTHER" ? <option value="COMPANY_CLEARANCE">Company clearance</option> : null}
                  </select></div>
                <div><Label htmlFor="rel-doc">Release document (linked as Release Evidence and verified)</Label>
                  <select id="rel-doc" className={inputClass} value={doc} onChange={(e) => setDoc(e.target.value)}><option value="">None</option>{evidence.map((l) => <option key={l.id} value={l.evidence_document_id}>{l.evidence_document_id.slice(0, 8)} · {human(l.verification_state)}</option>)}</select></div>
                <div><Label htmlFor="rel-sum" required>What was corrected</Label><textarea id="rel-sum" rows={2} className={inputClass} value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
                <div className="flex gap-2"><Button size="sm" onClick={() => void run(() => api.restriction(eventId, { action: "release", restrictionId: r.id, releaseBasis: basis, evidenceDocumentId: doc || null, correctionSummary: summary }), "Restriction released.").then(() => setOpen(null))}>Release restriction</Button><Button size="sm" variant="outline" onClick={() => setOpen(null)}>Cancel</Button></div>
              </div>
            ) : <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(r.id)}>Release…</Button>
          ) : null}
        </div>
      ))}
    </Card>
  )
}

function Evidence({ api, eventId, data, run, workflowRoles }: PanelProps & { workflowRoles?: readonly string[] }) {
  const links = data.evidence as Any[]
  const [file, setFile] = useState<File | null>(null)
  const [role, setRole] = useState<string>(workflowRoles?.[0] ?? "SOURCE_REPORT")
  const [pending, setPending] = useState<{ documentId: string; state: string } | null>(null)
  const roles = [...new Set([...(workflowRoles ?? []), ...EVIDENCE_ROLES])]
  async function upload() {
    if (!file) return
    await run(async () => { const r = await api.uploadEvidence(file, file.name); setPending({ documentId: r.documentId, state: r.state }); setFile(null) })
  }
  async function check() {
    if (!pending) return
    await run(async () => {
      const result = await api.finalizeEvidence(pending.documentId)
      const state = result.evidence.find((x) => x.documentId === pending.documentId)?.payload.state ?? pending.state
      setPending({ documentId: pending.documentId, state: String(state) })
      if (String(state) === "stored") { await api.evidence(eventId, { action: "link", documentId: pending.documentId, role }); setPending(null) }
    })
  }
  return (
    <Card title="Evidence" testId="evidence">
      <p className="text-[11px] text-muted-foreground">Files are uploaded to quarantine, scanned and stored before they can support an event. Linked is not verified: a person verifies each document.</p>
      {links.length === 0 ? <p className="text-xs text-muted-foreground">No evidence linked.</p> : null}
      {links.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2 text-xs">
          <span className="font-semibold">{human(l.role)}</span><span className="text-muted-foreground">{String(l.evidence_document_id).slice(0, 8)}</span>
          <Pill tone={l.link_status === "unlinked" ? undefined : l.verification_state === "VERIFIED" ? "ok" : "warn"}>{l.link_status === "unlinked" ? "Unlinked" : human(l.verification_state)}</Pill>
          <Pill>{human(String(l.lifecycle_state ?? "unknown"))}</Pill>
          {l.link_status === "active" && l.verification_state === "UNVERIFIED" ? <Button size="xs" variant="outline" onClick={() => void run(() => api.evidence(eventId, { action: "verify", linkId: l.id, decision: "VERIFIED", note: "Reviewed against the source." }), "Evidence verified.")}>Verify</Button> : null}
          {l.link_status === "active" ? <Button size="xs" variant="ghost" onClick={() => { const reason = window.prompt("Why is this evidence being unlinked?"); if (reason) void run(() => api.evidence(eventId, { action: "unlink", linkId: l.id, reason })) }}>Unlink</Button> : null}
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <div><Label htmlFor="ev-file">Add a file</Label><input id="ev-file" type="file" className={inputClass} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
        <div><Label htmlFor="ev-role">Role</Label><select id="ev-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((r) => <option key={r} value={r}>{human(r)}</option>)}</select></div>
        <Button size="sm" disabled={!file} onClick={() => void upload()}>Upload</Button>
      </div>
      {pending ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-xs" role="status">
          File accepted into quarantine ({human(pending.state)}). It can be linked once the scanner has cleared and stored it.
          <Button size="xs" variant="outline" onClick={() => void check()}>Check scan result and link</Button>
        </div>
      ) : null}
    </Card>
  )
}

function Consequences({ api, eventId, data, run, suggested }: PanelProps & { suggested?: readonly string[] }) {
  const rows = data.consequences as Any[]
  const [f, setF] = useState({ kind: suggested?.[0] ?? "COST_ACTUAL", state: "MEASURED", quantity: "", unit: "minutes", amount: "", currency: "CAD", source: "", confidence: "ESTIMATED", linkType: "", linkRef: "" })
  const kinds = [...new Set([...(suggested ?? []), ...CONSEQUENCE_KINDS])]
  const money = /COST|CLAIM|RECOVERY/.test(f.kind)
  const submit = () => run(() => api.consequence(eventId, {
    kind: f.kind, measurementState: f.state, source: f.source, confidence: f.confidence,
    ...(f.state === "MEASURED" ? (money ? { amountMinor: Math.round(Number(f.amount) * 100), currency: f.currency } : { quantity: Number(f.quantity), unit: f.unit }) : {}),
    ...(f.linkType && f.linkRef ? { linkType: f.linkType, linkRef: f.linkRef } : {}),
  }), "Consequence recorded.")
  return (
    <Card title="Consequences" testId="consequences">
      <p className="text-[11px] text-muted-foreground">Missing is never zero. Choose “None confirmed” only when someone confirmed there was none. One invoice, claim or repair order counts once.</p>
      {rows.map((c) => (
        <div key={c.id} className={`text-xs ${c.state === "SUPERSEDED" ? "text-muted-foreground line-through" : ""}`}>
          <span className="font-semibold">{human(c.kind)}</span> · {c.measurement_state === "MEASURED" ? [c.quantity ? `${Number(c.quantity)} ${c.unit}` : null, c.amount_minor !== null ? `${(Number(c.amount_minor) / 100).toFixed(2)} ${c.currency}` : null].filter(Boolean).join(" · ") : human(c.measurement_state)} · {c.source} · {human(c.confidence)}{c.state === "SUPERSEDED" ? " · superseded" : ""}
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-4">
        <div><Label htmlFor="c-kind">Kind</Label><select id="c-kind" className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{kinds.map((k) => <option key={k} value={k}>{human(k)}</option>)}</select></div>
        <div><Label htmlFor="c-state">Status</Label><select id="c-state" className={inputClass} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="MEASURED">Measured</option><option value="NONE_CONFIRMED">None confirmed</option><option value="NOT_COLLECTED">Not collected</option><option value="UNKNOWN">Unknown</option></select></div>
        {f.state === "MEASURED" ? (money
          ? <><div><Label htmlFor="c-amt">Amount</Label><input id="c-amt" type="number" step="0.01" min="0" className={inputClass} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div><div><Label htmlFor="c-cur">Currency</Label><select id="c-cur" className={inputClass} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option>CAD</option><option>USD</option></select></div></>
          : <><div><Label htmlFor="c-qty">Quantity</Label><input id="c-qty" type="number" step="any" min="0" className={inputClass} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></div><div><Label htmlFor="c-unit">Unit</Label><select id="c-unit" className={inputClass} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option>minutes</option><option>hours</option><option>days</option><option>injuries</option><option>fatalities</option><option>units</option></select></div></>) : null}
        <div><Label htmlFor="c-src" required>Source</Label><input id="c-src" className={inputClass} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></div>
        <div><Label htmlFor="c-conf">Confidence</Label><select id="c-conf" className={inputClass} value={f.confidence} onChange={(e) => setF({ ...f, confidence: e.target.value })}><option value="CONFIRMED">Confirmed</option><option value="ESTIMATED">Estimated</option><option value="UNVERIFIED">Unverified</option></select></div>
        <div><Label htmlFor="c-lt">Source record type</Label><input id="c-lt" className={inputClass} value={f.linkType} placeholder="INVOICE" onChange={(e) => setF({ ...f, linkType: e.target.value.toUpperCase() })} /></div>
        <div><Label htmlFor="c-lr">Source record reference</Label><input id="c-lr" className={inputClass} value={f.linkRef} onChange={(e) => setF({ ...f, linkRef: e.target.value })} /></div>
      </div>
      <Button size="sm" onClick={() => void submit()}>Record consequence</Button>
    </Card>
  )
}

function Actions({ api, eventId, data, run }: PanelProps) {
  const rows = data.actions as Any[]
  const [f, setF] = useState({ actionType: "CORRECTIVE", title: "", owner: "", due: "", required: false })
  return (
    <Card title="Corrective actions and follow-up" testId="actions">
      {rows.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">{a.title}</span><Pill>{human(a.action_type)}</Pill>{a.required ? <Pill tone="warn">Required</Pill> : null}<Pill tone={a.status === "COMPLETED" ? "ok" : undefined}>{human(a.status)}</Pill>
          <span className="text-muted-foreground">{a.owner_label ?? "No owner"}{a.due_date ? ` · due ${String(a.due_date).slice(0, 10)}` : ""}</span>
          {a.status === "OPEN" || a.status === "IN_PROGRESS" ? <Button size="xs" variant="outline" onClick={() => { const note = window.prompt("What was done?"); if (note) void run(() => api.action(eventId, { action: "update", actionId: a.id, status: "COMPLETED", note }), "Action completed.") }}>Complete</Button> : null}
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-5">
        <div><Label htmlFor="a-type">Type</Label><select id="a-type" className={inputClass} value={f.actionType} onChange={(e) => setF({ ...f, actionType: e.target.value })}>{ACTION_TYPES.map((t) => <option key={t} value={t}>{human(t)}</option>)}</select></div>
        <div className="sm:col-span-2"><Label htmlFor="a-title" required>Action</Label><input id="a-title" className={inputClass} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div><Label htmlFor="a-owner">Owner</Label><input id="a-owner" className={inputClass} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></div>
        <div><Label>Due</Label><TESDateField id="a-due" value={f.due} onValueChange={(v) => setF({ ...f, due: v })} /></div>
      </div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="size-3.5 accent-primary" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} />Required: the event cannot be closed until it is complete</label>
      <Button size="sm" onClick={() => void run(() => api.action(eventId, { action: "add", actionType: f.actionType, title: f.title, ownerLabel: f.owner || null, dueDate: f.due || null, required: f.required }), "Action added.")}>Add action</Button>
    </Card>
  )
}

function Relationships({ api, eventId, data, run }: PanelProps) {
  const rows = (data.relationships as Any[]).filter((r) => r.status === "active")
  const [f, setF] = useState({ type: "REPAIR_ORDER", target: "" })
  const toEvent = ["DUPLICATE_OF", "SAME_OCCURRENCE", "CAUSED_BY", "CAUSES", "FOLLOW_UP_OF", "RELATED"].includes(f.type)
  return (
    <Card title="Related events and records" testId="relationships">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-xs"><span className="font-semibold">{human(r.relationship_type)}</span><span className="text-muted-foreground">{r.to_event_id ?? r.to_record_ref}{r.from_event_id !== eventId ? " (points here)" : ""}</span>
          {r.from_event_id === eventId ? <Button size="xs" variant="ghost" onClick={() => { const reason = window.prompt("Why is this link being removed?"); if (reason) void run(() => api.relationship(eventId, { action: "remove", relationshipId: r.id, reason })) }}>Remove</Button> : null}
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <div><Label htmlFor="r-type">Relationship</Label><select id="r-type" className={inputClass} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{EVENT_RELATIONSHIPS.map((t) => <option key={t} value={t}>{human(t)}</option>)}</select></div>
        <div><Label htmlFor="r-target">{toEvent ? "Event id" : "Record reference (citation, repair order, claim …)"}</Label><input id="r-target" className={inputClass} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></div>
        <Button size="sm" onClick={() => void run(() => api.relationship(eventId, toEvent ? { action: "add", type: f.type, toEventId: f.target } : { action: "add", type: f.type, recordRef: f.target }), "Link added.")}>Add link</Button>
      </div>
    </Card>
  )
}

function Status({ api, eventId, e, run }: { api: ReturnType<typeof eventsApi>; eventId: string; e: Any; run: PanelProps["run"] }) {
  const [to, setTo] = useState<string>(e.status === "Closed" ? "Open" : "Under Review")
  const [reason, setReason] = useState("")
  return (
    <Card title="Status and closure" testId="status">
      {e.status === "Closed" ? <p className="text-xs">Closed {when(e.closed_at)} — {e.closure_reason}</p> : null}
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <div><Label htmlFor="s-to">Change status to</Label><select id="s-to" className={inputClass} value={to} onChange={(ev) => setTo(ev.target.value)}>{EVENT_STATUSES.filter((s) => s !== e.status).map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><Label htmlFor="s-reason">Reason{to === "Closed" || e.status === "Closed" ? " (required)" : ""}</Label><input id="s-reason" className={inputClass} value={reason} onChange={(ev) => setReason(ev.target.value)} /></div>
        <Button size="sm" onClick={() => void run(() => api.status(eventId, to, reason || undefined), `Status is now ${to}.`).then(() => setReason(""))}>Change status</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">An event with an active mandatory restriction or unfinished required follow-up cannot be closed.</p>
    </Card>
  )
}

function Analytical({ fact }: { fact: Any | null }) {
  if (!fact) return null
  const flags: string[] = Array.isArray(fact.quality_flags) ? fact.quality_flags : []
  const n = (v: unknown) => (v === null || v === undefined ? "not collected" : String(v))
  return (
    <Card title="Data quality and analytical fact (contract v1)" testId="analytical">
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
        {[["Resolution", fact.resolution_state], ["Source reliability", fact.source_reliability], ["Evidence (stored / verified)", `${fact.evidence_stored} / ${fact.evidence_verified}`], ["Data quality score", n(fact.data_quality_score)], ["Reporting lag (min)", n(fact.reporting_lag_minutes)], ["Delay (min)", n(fact.delay_minutes)], ["Downtime (min)", n(fact.downtime_minutes)], ["Actual cost (minor)", n(fact.cost_actual_minor)], ["Net impact (minor)", n(fact.net_impact_minor)]].map(([k, v]) => (
          <div key={String(k)}><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</dt><dd className="font-medium">{String(v)}</dd></div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-1.5">{flags.length ? flags.map((f) => <Pill key={f} tone="warn">{human(f)}</Pill>) : <span className="text-xs text-muted-foreground">No data-quality flags.</span>}</div>
    </Card>
  )
}
