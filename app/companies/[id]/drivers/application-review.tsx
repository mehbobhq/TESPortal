"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import * as api from "./prospect-api"
import type { ReviewApplication, ReviewRequirement } from "./prospect-api"

const STATUS_LABEL: Record<string, string> = { DECLARED: "Declared", EVIDENCE_RECEIVED: "Evidence received", PENDING: "Pending", VERIFIED: "Verified", EXCEPTION: "Exception", REJECTED: "Rejected" }
const STATUS_TONE: Record<string, string> = { VERIFIED: "border-emerald-300 bg-emerald-50 text-emerald-800", EXCEPTION: "border-amber-300 bg-amber-50 text-amber-800", REJECTED: "border-red-300 bg-red-50 text-red-800" }
const select = "h-9 w-full rounded-md border bg-background px-2 text-sm"

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—"
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? Object.values(v as object).filter(Boolean).join(", ") : String(v))).join(" | ")
  return typeof value === "object" ? JSON.stringify(value) : String(value)
}

export function ApplicationReview({ companyId, prospectId, status, onChanged }: { companyId: string; prospectId: string; status: string; onChanged: () => void }) {
  const [data, setData] = useState<{ applications: ReviewApplication[]; canSeeSensitive: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await api.getApplicationReview(companyId, prospectId))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the application.")
    }
  }, [companyId, prospectId])
  useEffect(() => { void load() }, [load])

  async function run(work: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setMessage(null)
    try {
      await work()
      setMessage({ tone: "ok", text: ok })
      onChanged()
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "The action could not be completed." })
    } finally {
      setBusy(false)
      await load()
    }
  }

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>
  if (!data) return <p className="text-sm text-muted-foreground">Loading application…</p>
  const submitted = data.applications.filter((a) => a.status === "SUBMITTED")
  if (submitted.length === 0) return <p className="text-sm text-muted-foreground">The applicant has not submitted yet.</p>

  return (
    <div className="space-y-6" data-testid="application-review">
      {message ? <p role="status" className={`text-sm ${message.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p> : null}
      {submitted.map((app) => (
        <ApplicationBlock key={app.id} app={app} companyId={companyId} prospectId={prospectId} prospectStatus={status} canSeeSensitive={data.canSeeSensitive} busy={busy} run={run} />
      ))}
    </div>
  )
}

function ApplicationBlock({ app, companyId, prospectId, prospectStatus, canSeeSensitive, busy, run }: {
  app: ReviewApplication; companyId: string; prospectId: string; prospectStatus: string; canSeeSensitive: boolean; busy: boolean; run: (work: () => Promise<unknown>, ok: string) => Promise<void>
}) {
  const sections = new Map<string, NonNullable<ReviewApplication["snapshot"]>["fields"]>()
  for (const f of app.snapshot?.fields ?? []) sections.set(f.section, [...(sections.get(f.section) ?? []), f])
  const latestDecision = app.decisions[app.decisions.length - 1]
  const doc = (id: string) => api.documentUrl(companyId, prospectId, app.id, id)

  return (
    <Card>
      <CardHeader className="border-b bg-muted/30 py-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {app.stage === "PRE_OFFER" ? "Application" : "Supplement"} · receipt {app.receiptId}
          <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">Applicant-declared — not verified</span>
          {latestDecision ? <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">Latest decision: {latestDecision.decision.replace("_", " ").toLowerCase()}</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-4 text-sm">
        <p className="text-xs text-muted-foreground">
          Received {app.submittedAt?.slice(0, 19).replace("T", " ")} UTC · SHA-256 {app.snapshotSha256?.slice(0, 16)}…{app.snapshotIntact === false ? " · INTEGRITY CHECK FAILED" : ""}
          {app.pdf ? <> · <a className="font-medium text-primary underline" href={doc(app.pdf.documentId)} target="_blank" rel="noreferrer">Open signed PDF</a></> : " · signed PDF pending"}
        </p>

        <section aria-label="Checks" className="space-y-3">
          <h3 className="text-sm font-semibold">Checks</h3>
          {app.requirements.map((r) => <RequirementRow key={r.key} r={r} applicationId={app.id} companyId={companyId} prospectId={prospectId} busy={busy} run={run} />)}
        </section>

        <DecisionForm app={app} companyId={companyId} prospectId={prospectId} busy={busy} run={run} canDecide={prospectStatus === "APPLICATION_SUBMITTED" || prospectStatus === "UNDER_REVIEW"} />

        <section aria-label="Authorizations" className="space-y-2">
          <h3 className="text-sm font-semibold">Authorizations</h3>
          {app.consents.length === 0 ? <p className="text-xs text-muted-foreground">None signed.</p> : null}
          {app.consents.map((c) => (
            <p key={c.id} className="text-xs">
              <span className="font-medium">{c.key}</span> v{c.version} · signed by {c.signatureName} · {c.acceptedAt.slice(0, 10)}
              {c.legalStatus !== "APPROVED" ? <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Pending legal review — cannot be relied on</span> : null}
              {c.revoked ? <span className="ml-2 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">Revoked</span> : null}
            </p>
          ))}
        </section>

        {app.reviewRequirements.length ? (
          <section aria-label="Open review items" className="space-y-1">
            <h3 className="text-sm font-semibold">Open regulatory review items</h3>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{app.reviewRequirements.map((r) => <li key={r.id}>{r.text}</li>)}</ul>
          </section>
        ) : null}

        <section aria-label="Documents" className="space-y-1">
          <h3 className="text-sm font-semibold">Documents</h3>
          {app.uploads.filter((u) => u.current).map((u) => (
            <p key={u.documentId} className="text-xs">
              {u.fieldId} · {u.filename} · {u.state ?? "recorded"} ·{" "}
              <a className="font-medium text-primary underline" href={doc(u.documentId)} target="_blank" rel="noreferrer">{u.state === "evidence" || u.state === "finalized" ? "View" : "View (when cleared)"}</a>
              {u.sensitivity === "restricted" ? <span className="ml-2 text-[10px] font-semibold text-amber-800">Restricted</span> : null}
            </p>
          ))}
          {app.uploads.filter((u) => u.current).length === 0 ? <p className="text-xs text-muted-foreground">No documents uploaded.</p> : null}
        </section>

        <details>
          <summary className="cursor-pointer text-sm font-semibold">Applicant’s answers</summary>
          <div className="mt-3 space-y-4">
            {[...sections.entries()].map(([section, fields]) => (
              <div key={section}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{section}</p>
                <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,240px)_1fr]">
                  {fields.map((f) => (<div key={f.id} className="contents"><dt className="text-xs text-muted-foreground">{f.label}</dt><dd className="break-words text-xs">{show(f.value)}</dd></div>))}
                </dl>
              </div>
            ))}
            {app.snapshot?.sensitiveNotCollected.length ? <p className="text-xs text-muted-foreground">Not collected on this application: {app.snapshot.sensitiveNotCollected.map((s) => s.fieldId).join(", ")}.</p> : null}
            {app.snapshot?.retainedNotApplicable.length ? <p className="text-xs text-muted-foreground">{app.snapshot.retainedNotApplicable.length} earlier answer(s) did not apply after later answers and are not treated as current.</p> : null}
          </div>
        </details>

        <SensitiveSection app={app} canSee={canSeeSensitive} companyId={companyId} prospectId={prospectId} />
        <CorrectionSection app={app} companyId={companyId} prospectId={prospectId} busy={busy} run={run} />

        {app.stage === "PRE_OFFER" && (prospectStatus === "APPLICATION_SUBMITTED" || prospectStatus === "UNDER_REVIEW") ? (
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">After a conditional offer, request the later-stage information (work eligibility, authorized background screening). It is a separate application; this one stays unchanged.</p>
            <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => run(() => api.requestSupplement(companyId, prospectId, app.id), "Conditional-offer application sent.")}>Request conditional-offer information</Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function RequirementRow({ r, applicationId, companyId, prospectId, busy, run }: { r: ReviewRequirement; applicationId: string; companyId: string; prospectId: string; busy: boolean; run: (work: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState("VERIFIED")
  const [note, setNote] = useState("")
  const current = r.current?.status
  return (
    <div className="rounded-lg border p-3" data-testid={`check-${r.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-medium">{r.title}</p>
        {r.requiredForQualification ? <span className="text-[10px] font-semibold uppercase text-muted-foreground">Required</span> : null}
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[current ?? ""] ?? "border-slate-300 bg-slate-50 text-slate-700"}`}>{current ? STATUS_LABEL[current] : "Not started"}</span>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Close" : "Record"}</Button>
      </div>
      {r.consent && !r.consent.relianceAllowed ? <p className="mt-1 text-xs text-amber-800">{r.consent.reason}</p> : null}
      {r.external ? <p className="mt-1 text-xs text-muted-foreground">Completed through its own official process; record the outcome here.</p> : null}
      {r.current?.note ? <p className="mt-1 text-xs text-muted-foreground">Note: {r.current.note}</p> : null}
      {open ? (
        <form className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); void run(() => api.recordVerification(companyId, prospectId, { applicationId, requirementKey: r.key, status, note }), "Recorded.").then(() => { setNote(""); setOpen(false) }) }}>
          <div className="space-y-1"><Label htmlFor={`st-${r.key}`}>Outcome</Label>
            <select id={`st-${r.key}`} className={select} value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor={`nt-${r.key}`}>Evidence or note</Label><Input id={`nt-${r.key}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></div>
          <Button type="submit" size="sm" disabled={busy}>Save</Button>
        </form>
      ) : null}
    </div>
  )
}

function DecisionForm({ app, companyId, prospectId, busy, run, canDecide }: { app: ReviewApplication; companyId: string; prospectId: string; busy: boolean; run: (work: () => Promise<unknown>, ok: string) => Promise<void>; canDecide: boolean }) {
  const [reasons, setReasons] = useState("")
  const [ackReview, setAckReview] = useState(false)
  if (!canDecide) return null
  const decide = (decision: string) => run(() => api.recordDecision(companyId, prospectId, { applicationId: app.id, decision, reasons: reasons.split("\n").filter(Boolean), acknowledgeReviewRequirements: ackReview }), "Decision recorded.")
  return (
    <section aria-label="Qualification decision" className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <h3 className="text-sm font-semibold">Qualification decision</h3>
      {app.blockers.length ? <ul className="list-disc pl-5 text-xs text-muted-foreground">{app.blockers.map((b) => <li key={b}>{b}</li>)}</ul> : <p className="text-xs text-emerald-700">Every required check has an outcome.</p>}
      <textarea aria-label="Reasons (one per line)" className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" placeholder="Reasons, one per line" value={reasons} onChange={(e) => setReasons(e.target.value)} />
      {app.reviewRequirements.length ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={ackReview} onChange={(e) => setAckReview(e.target.checked)} />I have reviewed the open regulatory review items.</label> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !app.canQualify} onClick={() => decide("QUALIFIED")}>Mark qualified</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("NEEDS_INFORMATION")}>Needs information</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("NOT_QUALIFIED")}>Not qualified</Button>
      </div>
    </section>
  )
}

function CorrectionSection({ app, companyId, prospectId, busy, run }: { app: ReviewApplication; companyId: string; prospectId: string; busy: boolean; run: (work: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [fieldId, setFieldId] = useState("")
  const [value, setValue] = useState("")
  const [reason, setReason] = useState("")
  return (
    <section aria-label="Corrections" className="space-y-2">
      <h3 className="text-sm font-semibold">Corrections</h3>
      <p className="text-xs text-muted-foreground">The signed application is never edited. A correction is a separate record that names the field, the declared value and the reason.</p>
      {app.corrections.map((c) => <p key={c.id} className="text-xs"><span className="font-medium">{c.fieldId}</span>: {show(c.previousValue)} → {show(c.correctedValue)} · {c.reason} · {c.recordedAt.slice(0, 10)}</p>)}
      {open ? (
        <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run(() => api.recordCorrection(companyId, prospectId, { applicationId: app.id, fieldId, correctedValue: value, reason }), "Correction recorded.").then(() => { setOpen(false); setValue(""); setReason("") }) }}>
          <div className="space-y-1"><Label htmlFor={`cf-${app.id}`}>Answer</Label>
            <select id={`cf-${app.id}`} className={select} required value={fieldId} onChange={(e) => setFieldId(e.target.value)}><option value="">Choose…</option>{(app.snapshot?.fields ?? []).filter((f) => f.type !== "repeatable").map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor={`cv-${app.id}`}>Corrected value</Label><Input id={`cv-${app.id}`} value={value} onChange={(e) => setValue(e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor={`cr-${app.id}`}>Reason</Label><Input id={`cr-${app.id}`} required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></div>
          <div className="flex gap-2 sm:col-span-2"><Button type="submit" size="sm" disabled={busy}>Record correction</Button><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
        </form>
      ) : <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Record a correction</Button>}
    </section>
  )
}

function SensitiveSection({ app, canSee, companyId, prospectId }: { app: ReviewApplication; canSee: boolean; companyId: string; prospectId: string }) {
  const [purpose, setPurpose] = useState("")
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)
  if (app.sensitive.length === 0) return null
  return (
    <section aria-label="Restricted identifiers" className="space-y-2">
      <h3 className="text-sm font-semibold">Restricted identifiers</h3>
      {err ? <p role="alert" className="text-xs text-red-600">{err}</p> : null}
      {app.sensitive.map((s) => (
        <div key={s.fieldId} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">{s.fieldId}</span><span className="text-muted-foreground">{s.masked ?? "Collected securely"}</span>
          {canSee ? (
            revealed[s.fieldId] ? <span className="font-mono">{revealed[s.fieldId]}</span> : (
              <>
                <Input aria-label="Purpose for viewing" className="h-8 w-56" placeholder="Why do you need this?" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={300} />
                <Button size="sm" variant="outline" disabled={!purpose.trim()} onClick={async () => { setErr(null); try { const r = await api.revealSensitiveValue(companyId, prospectId, { applicationId: app.id, fieldId: s.fieldId, purpose }); setRevealed({ ...revealed, [s.fieldId]: r.value }) } catch (e) { setErr(e instanceof Error ? e.message : "Unable to show.") } }}>Show (recorded)</Button>
              </>
            )
          ) : <span className="text-muted-foreground">You do not have access to view this.</span>}
        </div>
      ))}
    </section>
  )
}
