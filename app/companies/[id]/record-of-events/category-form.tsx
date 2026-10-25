"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { TESDateField, TESTimeField } from "@/components/ui/tes-date-field"
import { CATEGORY_WORKFLOWS, DETAILED_WIZARD_CATEGORIES, sectionsFor, type WorkflowSection } from "@/lib/driver-events/workflows"
import { fieldIsVisible, SEVERITIES, type EventInput, type FactState, type Scalar } from "@/lib/driver-events/validation"
import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY, resolvePerformanceApplicability } from "@/lib/driver-performance-schema"
import { IANA_TIME_ZONES } from "@/lib/performance-near-miss-taxonomy"
import { EventsApiError, eventsApi, type DriverOption, type Issue, type VehicleOption } from "./events-api"
import { ChildCollectionsEditor } from "./child-collections-editor"
import { FieldInput, Label, inputClass } from "./field-input"

type Header = {
  title: string; narrative: string; date: string; time: string; timeZone: string; approximate: boolean; reportedDate: string; sourceType: string; sourceReference: string
  driver: string; vehicle: string; trailer: string; loadReference: string; shipmentReference: string; customerReference: string
  locationText: string; city: string; stateProvince: string; country: string; jurisdictionCode: string; severity: string; potentialSeverity: string
}

export type CorrectionSeed = {
  id: string; version: number; header: Partial<Header>;
  /** Recorded header values this form does not edit (reporter, subtype, origin, exact report time, coordinates): a correction carries them through unchanged. */
  preserved?: Pick<EventInput, "reporterLabel" | "subtype" | "ingestionOrigin" | "reportedAt" | "tripReference"> & { latitude?: number | null; longitude?: number | null }; facts: Record<string, Scalar>; factStates: Record<string, FactState>; factUnits: Record<string, string>; childCollections: Record<string, unknown>
}

const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto" } catch { return "America/Toronto" } }
const asText = (v: unknown) => (v === null || v === undefined ? "" : String(v))

export function CategoryEventForm({
  companyId, code, drivers, vehicles, seed, onSaved, onCancel,
}: {
  companyId: string; code: string; drivers: DriverOption[]; vehicles: VehicleOption[]; seed?: CorrectionSeed; onSaved: (id: string, notice?: string) => void; onCancel: () => void
}) {
  const definition = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.find((d) => d.code === code)!
  const workflow = CATEGORY_WORKFLOWS[code]
  const wizardCategory = (DETAILED_WIZARD_CATEGORIES as readonly string[]).includes(definition.value)
  const api = useMemo(() => eventsApi(companyId), [companyId])
  const fields = useMemo(() => new Map(definition.fields.map((f) => [f.key, f])), [definition])
  const sections: WorkflowSection[] = useMemo(() => {
    if (workflow) return sectionsFor(code)
    return [{ id: "facts", title: "Facts", keys: definition.fields.filter((f) => !f.hiddenInCreation).map((f) => f.key) }]
  }, [workflow, code, definition])

  const [h, setH] = useState<Header>({
    title: "", narrative: "", date: "", time: "", timeZone: browserZone(), approximate: false, reportedDate: "", sourceType: definition.sources[0], sourceReference: "", driver: "", vehicle: "", trailer: "",
    loadReference: "", shipmentReference: "", customerReference: "", locationText: "", city: "", stateProvince: "", country: "CA", jurisdictionCode: "", severity: "Not Applicable", potentialSeverity: "",
    ...seed?.header,
  })
  const [facts, setFacts] = useState<Record<string, Scalar>>(seed?.facts ?? {})
  const [states, setStates] = useState<Record<string, FactState>>(seed?.factStates ?? {})
  const [units, setUnits] = useState<Record<string, string>>(seed?.factUnits ?? {})
  const [collections, setCollections] = useState<Record<string, unknown>>(seed?.childCollections ?? {})
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message
  const set = <K extends keyof Header>(key: K, value: Header[K]) => setH((cur) => ({ ...cur, [key]: value }))

  function buildInput(recordState: "DRAFT" | "RECORDED"): EventInput {
    const cleanUnits: Record<string, string> = {}
    for (const [k, v] of Object.entries(units)) if (k in facts) cleanUnits[k] = v
    return {
      category: definition.value,
      title: h.title,
      narrative: h.narrative || null,
      recordState,
      occurrence: { date: h.date || null, time: h.time || null, timeZone: h.time ? h.timeZone : h.timeZone || null, approximate: h.approximate },
      reportedDate: h.reportedDate || null,
      ...(seed?.preserved ? { reporterLabel: seed.preserved.reporterLabel ?? null, subtype: seed.preserved.subtype ?? null, ingestionOrigin: seed.preserved.ingestionOrigin, reportedAt: seed.preserved.reportedAt ?? null, tripReference: seed.preserved.tripReference ?? null } : {}),
      sourceType: h.sourceType,
      sourceReference: h.sourceReference || null,
      driverRelationshipId: h.driver || null,
      vehicleRelationshipId: h.vehicle || null,
      trailerRelationshipId: h.trailer || null,
      loadReference: h.loadReference || null,
      shipmentReference: h.shipmentReference || null,
      customerReference: h.customerReference || null,
      location: { text: h.locationText || null, city: h.city || null, stateProvince: h.stateProvince || null, country: h.country || null, jurisdictionCode: h.jurisdictionCode || null, latitude: seed?.preserved?.latitude ?? null, longitude: seed?.preserved?.longitude ?? null },
      observedSeverity: h.severity,
      potentialSeverity: h.potentialSeverity || null,
      facts, factStates: states, factUnits: cleanUnits,
      childCollections: collections,
    }
  }

  async function save(recordState: "DRAFT" | "RECORDED") {
    setSaving(true); setError(null); setIssues([])
    try {
      if (seed) {
        if (!reason.trim()) { setError("Say why this record is being corrected."); return }
        const done = await api.correct(seed.id, seed.version, buildInput(recordState), reason.trim())
        onSaved(seed.id, `Saved as version ${done.version}.`)
      } else {
        const created = await api.create(buildInput(recordState))
        onSaved(created.id, created.possibleDuplicates.length ? `Saved. ${created.possibleDuplicates.length} possible duplicate(s) found - review them on the event.` : undefined)
      }
    } catch (e) {
      if (e instanceof EventsApiError) { setError(e.message); setIssues(e.issues) } else setError("The event could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  const power = vehicles.filter((v) => !/trailer/i.test(v.vehicleType))
  const trailers = vehicles.filter((v) => /trailer/i.test(v.vehicleType))

  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); void save("RECORDED") }} aria-label={`${definition.label} event`}>
      {workflow ? (
        <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs leading-5">
          <p className="font-semibold text-foreground">{workflow.intro}</p>
          <p className="mt-1 text-muted-foreground">{workflow.boundary}</p>
          {workflow.createsRestriction ? <p className="mt-2 font-semibold text-destructive">Answering that the equipment is not safe to operate places a mandatory hold on the vehicle. Only a documented release clears it.</p> : null}
        </div>
      ) : null}
      {error ? <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}

      <Section title="What happened and when" hint="The occurrence is a real instant: its time zone is recorded so it never shifts.">
        <div className="sm:col-span-2">
          <Label htmlFor="ev-title" required>Title</Label>
          <input id="ev-title" className={inputClass} value={h.title} onChange={(e) => set("title", e.target.value)} />
          {issueFor("title") ? <p role="alert" className="text-[11px] text-destructive">{issueFor("title")}</p> : null}
        </div>
        <div>
          <Label required>Date it occurred</Label>
          <TESDateField id="ev-date" value={h.date} onValueChange={(v) => set("date", v)} />
          {issueFor("occurrence.date") ? <p role="alert" className="text-[11px] text-destructive">{issueFor("occurrence.date")}</p> : null}
        </div>
        <div>
          <Label>Time it occurred (optional)</Label>
          <TESTimeField id="ev-time" value={h.time} onValueChange={(v: string) => set("time", v)} />
          {issueFor("occurrence.time") ? <p role="alert" className="text-[11px] text-destructive">{issueFor("occurrence.time")}</p> : <p className="text-[10px] text-muted-foreground">Leave blank if the time is not known: the event is then recorded by date only.</p>}
        </div>
        <div>
          <Label htmlFor="ev-zone">Time zone of the occurrence</Label>
          <select id="ev-zone" className={inputClass} value={h.timeZone} onChange={(e) => set("timeZone", e.target.value)}>
            {[...new Set([h.timeZone, ...IANA_TIME_ZONES.map((z: { value: string } | string) => (typeof z === "string" ? z : z.value))])].map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          {issueFor("occurrence.timeZone") ? <p role="alert" className="text-[11px] text-destructive">{issueFor("occurrence.timeZone")}</p> : null}
        </div>
        <div>
          <Label>Date it was reported</Label>
          <TESDateField id="ev-reported" value={h.reportedDate} onValueChange={(v) => set("reportedDate", v)} />
          {issueFor("reportedDate") ? <p role="alert" className="text-[11px] text-destructive">{issueFor("reportedDate")}</p> : null}
        </div>
        <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={h.approximate} onChange={(e) => set("approximate", e.target.checked)} className="size-3.5 accent-primary" />The date or time is approximate</label>
        <div className="sm:col-span-2">
          <Label htmlFor="ev-narrative">Narrative</Label>
          <textarea id="ev-narrative" rows={3} className={inputClass} value={h.narrative} onChange={(e) => set("narrative", e.target.value)} />
        </div>
      </Section>

      <Section title="Who and what was involved" hint="Linked to the company's own driver and vehicle records. Nothing is copied.">
        <div>
          <Label htmlFor="ev-driver">Driver</Label>
          <select id="ev-driver" className={inputClass} value={h.driver} onChange={(e) => set("driver", e.target.value)}>
            <option value="">Not linked</option>
            {drivers.map((d) => <option key={d.relationshipId} value={d.relationshipId}>{d.label}</option>)}
          </select>
          {issueFor("driverRelationshipId") ? <p role="alert" className="text-[11px] text-destructive">{issueFor("driverRelationshipId")}</p> : null}
        </div>
        <div>
          <Label htmlFor="ev-vehicle">Power unit</Label>
          <select id="ev-vehicle" className={inputClass} value={h.vehicle} onChange={(e) => set("vehicle", e.target.value)}>
            <option value="">Not linked</option>
            {power.map((v) => <option key={v.relationshipId} value={v.relationshipId}>Unit {v.unitNumber}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="ev-trailer">Trailer</Label>
          <select id="ev-trailer" className={inputClass} value={h.trailer} onChange={(e) => set("trailer", e.target.value)}>
            <option value="">Not linked</option>
            {trailers.map((v) => <option key={v.relationshipId} value={v.relationshipId}>Unit {v.unitNumber}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="ev-source">Source</Label>
          <select id="ev-source" className={inputClass} value={h.sourceType} onChange={(e) => set("sourceType", e.target.value)}>
            {definition.sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {issueFor("sourceType") ? <p role="alert" className="text-[11px] text-destructive">{issueFor("sourceType")}</p> : null}
        </div>
        <div>
          <Label htmlFor="ev-source-ref">Source reference</Label>
          <input id="ev-source-ref" className={inputClass} value={h.sourceReference} onChange={(e) => set("sourceReference", e.target.value)} />
          <p className="text-[10px] text-muted-foreground">A report or record number as given. The same source can create an event only once.</p>
        </div>
        <div>
          <Label htmlFor="ev-load">Load reference</Label>
          <input id="ev-load" className={inputClass} value={h.loadReference} onChange={(e) => set("loadReference", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ev-shipment">Shipment reference</Label>
          <input id="ev-shipment" className={inputClass} value={h.shipmentReference} onChange={(e) => set("shipmentReference", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ev-customer">Customer reference</Label>
          <input id="ev-customer" className={inputClass} value={h.customerReference} onChange={(e) => set("customerReference", e.target.value)} />
        </div>
      </Section>

      <Section title="Where and how serious">
        <div className="sm:col-span-2">
          <Label htmlFor="ev-loc">Location</Label>
          <input id="ev-loc" className={inputClass} value={h.locationText} onChange={(e) => set("locationText", e.target.value)} />
        </div>
        <div><Label htmlFor="ev-city">City</Label><input id="ev-city" className={inputClass} value={h.city} onChange={(e) => set("city", e.target.value)} /></div>
        <div><Label htmlFor="ev-prov">Province / state</Label><input id="ev-prov" className={inputClass} value={h.stateProvince} onChange={(e) => set("stateProvince", e.target.value)} /></div>
        <div>
          <Label htmlFor="ev-country">Country</Label>
          <select id="ev-country" className={inputClass} value={h.country} onChange={(e) => set("country", e.target.value)}><option value="">Unknown</option><option value="CA">Canada</option><option value="US">United States</option></select>
        </div>
        <div>
          <Label htmlFor="ev-jur">Jurisdiction code</Label>
          <input id="ev-jur" className={inputClass} value={h.jurisdictionCode} placeholder="CA-ON" onChange={(e) => set("jurisdictionCode", e.target.value.toUpperCase())} />
          {issueFor("location.jurisdictionCode") ? <p role="alert" className="text-[11px] text-destructive">{issueFor("location.jurisdictionCode")}</p> : null}
        </div>
        <div>
          <Label htmlFor="ev-sev">Severity (as observed)</Label>
          <select id="ev-sev" className={inputClass} value={h.severity} onChange={(e) => set("severity", e.target.value)}>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        <div>
          <Label htmlFor="ev-psev">Potential severity</Label>
          <select id="ev-psev" className={inputClass} value={h.potentialSeverity} onChange={(e) => set("potentialSeverity", e.target.value)}><option value="">Not assessed</option>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
      </Section>

      {sections.map((section) => {
        const visible = section.keys.map((k) => fields.get(k)).filter((f): f is NonNullable<typeof f> => !!f && !f.hiddenInCreation && fieldIsVisible(f, facts))
        if (!visible.length) return null
        return (
          <Section key={section.id} title={section.title} hint={section.hint}>
            {visible.map((field) => {
              const required = field.required === true || resolvePerformanceApplicability(field.applicability, facts) === "REQUIRED"
              return (
                <div key={field.key} className={field.kind === "textarea" ? "sm:col-span-2" : ""}>
                  <FieldInput
                    field={field} required={required} value={facts[field.key]} unit={units[field.key]} state={states[field.key]} error={issueFor(`facts.${field.key}`) ?? issueFor(`factUnits.${field.key}`)}
                    onChange={(v) => setFacts((cur) => { const n = { ...cur }; if (v === undefined) delete n[field.key]; else n[field.key] = v; return n })}
                    onUnit={(u) => setUnits((cur) => { const n = { ...cur }; if (u === undefined) delete n[field.key]; else n[field.key] = u; return n })}
                    onState={(s) => setStates((cur) => { const n = { ...cur }; if (s === undefined) delete n[field.key]; else n[field.key] = s; return n })}
                  />
                </div>
              )
            })}
          </Section>
        )
      })}

      {seed ? <ChildCollectionsEditor value={collections} onChange={setCollections} /> : null}

      {seed ? (
        <Section title="Why is this being corrected?" hint="The earlier version stays in the history exactly as it was recorded.">
          <div className="sm:col-span-2"><Label htmlFor="ev-reason" required>Reason</Label><textarea id="ev-reason" rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </Section>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        {!seed ? <Button type="button" variant="outline" disabled={saving} onClick={() => void save("DRAFT")}>Save as draft</Button> : null}
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : seed ? "Save correction" : "Record event"}</Button>
      </div>
    </form>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border p-4">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}

export { asText }
