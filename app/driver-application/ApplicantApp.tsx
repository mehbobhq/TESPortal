"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { evalCond } from "@/lib/driver-application/conditions"
import { applicableFields, validateAnswers, type Answers } from "@/lib/driver-application/validate"
import type { ApplicantView, PresentedConsent } from "@/lib/driver-application/applicant-service"
import { ApiError, api, getCsrf, setCsrf } from "./api-client"
import { FieldControl, primaryBtn, secondaryBtn } from "./FieldControls"
import { DriverApplicationBrandHeader } from "./DriverApplicationBrandHeader"
import { DriverApplicationFooter } from "./DriverApplicationFooter"

type Phase = "loading" | "invalid" | "ready" | "receipt"
type SaveState = "idle" | "saving" | "saved" | "error" | "conflict"

/** The invitation secret travels in the URL fragment only: fragments are never sent to a server, logged, or forwarded in Referer headers. */
function readSecret(): string | null {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("k")
}

export default function ApplicantApp() {
  const [phase, setPhase] = useState<Phase>("loading")
  const [view, setView] = useState<ApplicantView | null>(null)
  const [answers, setAnswers] = useState<Answers>({})
  const [version, setVersion] = useState(0)
  const [save, setSave] = useState<SaveState>("idle")
  const [step, setStep] = useState(0)
  const [serverErrors, setServerErrors] = useState<{ errors: Record<string, string>; itemErrors: Record<string, Array<Record<string, string>>> }>({ errors: {}, itemErrors: {} })
  const [receipt, setReceipt] = useState<{ receiptId: string; submittedAt: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const dirty = useRef<Set<string>>(new Set())
  const versionRef = useRef(0)
  const answersRef = useRef<Answers>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const load = useCallback(async () => {
    const v = await api<ApplicantView>("/api/driver-applications/application")
    setView(v)
    setAnswers(v.answers)
    answersRef.current = v.answers
    setVersion(v.answersVersion)
    versionRef.current = v.answersVersion
    if (v.application.status === "SUBMITTED") {
      setReceipt({ receiptId: v.application.receiptId ?? "", submittedAt: v.application.submittedAt ?? "" })
      setPhase("receipt")
    } else setPhase("ready")
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const secret = readSecret()
        if (secret) {
          const r = await api<{ csrfToken: string }>("/api/driver-applications/session", { method: "POST", json: { secret } })
          setCsrf(r.csrfToken)
          window.history.replaceState(null, "", window.location.pathname) // the secret never stays in the address bar or history
        } else if (!getCsrf()) {
          throw new ApiError(401, "no session", {})
        }
        await load()
      } catch {
        if (!cancelled) setPhase("invalid")
      }
    })()
    return () => { cancelled = true }
  }, [load])

  const flush = useCallback(async () => {
    if (dirty.current.size === 0) return
    const keys = [...dirty.current]
    dirty.current = new Set()
    setSave("saving")
    try {
      const patch: Answers = {}
      for (const k of keys) patch[k] = answersRef.current[k] ?? null
      const r = await api<{ version: number; errors: Record<string, string>; itemErrors: Record<string, Array<Record<string, string>>> }>("/api/driver-applications/draft", { method: "PATCH", json: { version: versionRef.current, patch } })
      versionRef.current = r.version
      setVersion(r.version)
      setServerErrors({ errors: r.errors, itemErrors: r.itemErrors })
      setSave(dirty.current.size ? "saving" : "saved")
    } catch (e) {
      for (const k of keys) dirty.current.add(k)
      if (e instanceof ApiError && e.status === 409) {
        setSave("conflict")
        setBanner("This application was changed in another window. Reload the page to continue.")
      } else if (e instanceof ApiError && e.status === 401) setPhase("invalid")
      else setSave("error")
    }
  }, [])

  const queueSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 900)
  }, [flush])

  const change = (id: string, value: unknown) => {
    answersRef.current = { ...answersRef.current, [id]: value }
    setAnswers(answersRef.current)
    dirty.current.add(id)
    setSave("saving")
    queueSave()
  }
  const blurNow = () => { if (timer.current) clearTimeout(timer.current); void flush() }

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current.size) { e.preventDefault() } }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  const extras = useMemo(() => view ? ({
    uploads: view.uploads.map((u) => ({ fieldId: u.fieldId, slot: u.slot, state: u.state })),
    sensitiveCollected: view.sensitiveCollected,
    consents: view.consents.map((c) => ({ key: c.key, version: c.version, textSha256: c.textSha256 })),
  }) : null, [view])

  const live = useMemo(() => (view && extras ? validateAnswers(view.plan, answers, "submit", extras) : null), [view, extras, answers])
  const applicable = useMemo(() => (view ? applicableFields(view.plan, answers) : []), [view, answers])

  const sections = useMemo(() => {
    if (!view) return []
    const scope = { ctx: view.plan.context as unknown as Record<string, unknown>, ans: answers }
    return view.plan.sections
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        section: s,
        fields: applicable.filter((a) => a.field.section === s.id).sort((a, b) => a.field.order - b.field.order),
        consents: s.id === "authorizations" ? view.plan.consents.filter((c) => evalCond(c.appliesWhen, scope) !== "F") : [],
      }))
      .filter((s) => s.fields.length || s.consents.length)
  }, [view, applicable, answers])

  const totalSteps = sections.length + 1 // + review
  useEffect(() => { headingRef.current?.focus() }, [step, phase])

  if (phase === "loading") return <Frame><p role="status" className="py-24 text-center text-[#475569]">Opening your application…</p></Frame>
  if (phase === "invalid" || !view) {
    return (
      <Frame>
        <div className="mx-auto max-w-md py-20 text-center">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-[#0B1F44] outline-none">This link can’t be used</h1>
          <p className="mt-3 text-[#475569]">The link may have expired or been replaced. Ask the company that invited you to send a new application link.</p>
        </div>
      </Frame>
    )
  }
  const locked = view.application.status !== "DRAFT"

  if (phase === "receipt" && receipt) {
    return (
      <Frame company={view.companyName}>
        <div className="mx-auto max-w-xl py-10 text-center">
          <div aria-hidden className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#DCFCE7] text-2xl text-[#166534]">✓</div>
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-[#0B1F44] outline-none">Application received</h1>
          <p className="mt-3 text-[#475569]">Thank you, {view.applicantName || "driver"}. {view.companyName} will review your application. Receiving it is not a hiring decision, and nothing in it has been verified yet.</p>
          <dl className="mx-auto mt-6 max-w-sm rounded-2xl border border-[#E2E8F0] bg-white p-4 text-left text-sm">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Receipt number</dt>
            <dd className="mt-0.5 break-all font-mono text-[#0B1F44]">{receipt.receiptId}</dd>
            <dt className="mt-3 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Received</dt>
            <dd className="mt-0.5 text-[#0B1F44]">{receipt.submittedAt ? new Date(receipt.submittedAt).toLocaleString() : ""}</dd>
          </dl>
        </div>
      </Frame>
    )
  }

  const isReview = step >= sections.length
  const current = sections[Math.min(step, sections.length - 1)]
  const progress = Math.round((Math.min(step, totalSteps - 1) / (totalSteps - 1 || 1)) * 100)
  const itemErrorsOf = (id: string) => (live?.itemErrors[id] ?? serverErrors.itemErrors[id])
  const errorOf = (id: string) => live?.errors[id]
  const sectionIssues = (fieldIds: string[]) => fieldIds.filter((id) => live?.errors[id] || live?.itemErrors[id]?.some((r) => Object.keys(r).length)).length

  async function submit() {
    setSubmitting(true)
    setBanner(null)
    try {
      if (timer.current) clearTimeout(timer.current)
      await flush()
      const r = await api<{ receiptId: string; submittedAt: string }>("/api/driver-applications/submit", { method: "POST", json: {} })
      setReceipt(r)
      setPhase("receipt")
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setBanner("Some answers still need attention. They are marked below.")
      else setBanner(e instanceof Error ? e.message : "The application could not be submitted.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Frame company={view.companyName}>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[#475569]">
            <span>Step {Math.min(step + 1, totalSteps)} of {totalSteps}</span>
            <span role="status" aria-live="polite">{save === "saving" ? "Saving…" : save === "saved" ? "All changes saved" : save === "error" ? "Not saved — check your connection" : save === "conflict" ? "Reload needed" : ""}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#E2E8F0]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Application progress">
            <div className="h-full rounded-full bg-[#0B1F44] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.max(progress, 4)}%` }} />
          </div>
          <ol className="mt-3 hidden flex-wrap gap-1.5 sm:flex">
            {[...sections.map((s) => s.section.title), "Review"].map((t, i) => (
              <li key={t}><button type="button" onClick={() => { blurNow(); setStep(i) }} aria-current={i === step ? "step" : undefined} className={`rounded-full px-3 py-1 text-xs font-semibold ${i === step ? "bg-[#0B1F44] text-white" : "bg-[#F1F5F9] text-[#334155] hover:bg-[#E2E8F0]"}`}>{t}</button></li>
            ))}
          </ol>
        </div>

        {banner ? <div role="alert" className="mb-5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm font-medium text-[#991B1B]">{banner}</div> : null}

        {!isReview && current ? (
          <section aria-labelledby="step-title" className="space-y-6">
            <div>
              <h1 id="step-title" ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-[#0B1F44] outline-none">{current.section.title}</h1>
              <p className="mt-1.5 text-[15px] leading-6 text-[#475569]">{current.section.intro}</p>
            </div>
            <div className="space-y-6 rounded-3xl border border-[#E2E8F0] bg-white p-5 shadow-sm sm:p-7">
              {current.fields.map(({ field, required }) => (
                <FieldControl
                  key={field.id}
                  field={field}
                  required={required}
                  value={answers[field.id]}
                  error={errorOf(field.id) && touchedError(field.id, answers, serverErrors.errors) ? errorOf(field.id) : serverErrors.errors[field.id]}
                  itemErrors={itemErrorsOf(field.id)}
                  uploads={view.uploads}
                  sensitiveCollected={view.sensitiveCollected.includes(field.id)}
                  locked={locked}
                  onChange={(v) => change(field.id, v)}
                  onBlur={blurNow}
                  onUploaded={() => void flush().then(load)}
                />
              ))}
              {current.consents.map((c) => (
                <ConsentCard key={`${c.key}@${c.version}`} consent={c} accepted={view.consents.find((a) => a.key === c.key && a.version === c.version && a.textSha256 === c.textSha256)} legalName={legalName(view, answers)} onAccepted={() => void flush().then(load)} />
              ))}
            </div>
          </section>
        ) : (
          <section aria-labelledby="step-title" className="space-y-5">
            <div>
              <h1 id="step-title" ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-[#0B1F44] outline-none">Review and submit</h1>
              <p className="mt-1.5 text-[15px] leading-6 text-[#475569]">Check each part. When you submit, your answers are locked and sent to {view.companyName}. Submitting is not a hiring decision, and nothing is treated as verified until the company verifies it.</p>
            </div>
            <ul className="divide-y divide-[#E2E8F0] overflow-hidden rounded-3xl border border-[#E2E8F0] bg-white">
              {sections.map((s, i) => {
                const issues = sectionIssues(s.fields.map((f) => f.field.id)) + (s.section.id === "authorizations" ? live?.missingConsents.length ?? 0 : 0)
                return (
                  <li key={s.section.id} className="flex items-center justify-between gap-3 px-5 py-4">
                    <div>
                      <div className="font-semibold text-[#0B1F44]">{s.section.title}</div>
                      <div className={`text-sm ${issues ? "text-[#B91C1C]" : "text-[#166534]"}`}>{issues ? `${issues} item${issues === 1 ? "" : "s"} need attention` : "Complete"}</div>
                    </div>
                    <button type="button" className={secondaryBtn} onClick={() => setStep(i)}>{issues ? "Fix" : "Edit"}</button>
                  </li>
                )
              })}
            </ul>
            {view.plan.regulatoryReviewRequirements.length ? (
              <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm leading-6 text-[#475569]">Some checks for your situation need the company’s own review. You do not need to do anything about them now.</p>
            ) : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <button type="button" className={secondaryBtn} onClick={() => setStep(Math.max(0, sections.length - 1))}>Back</button>
              <button type="button" className={primaryBtn} disabled={submitting || locked || save === "conflict"} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit application"}</button>
            </div>
          </section>
        )}

        {!isReview ? (
          <div className="mt-6 flex justify-between gap-3">
            <button type="button" className={secondaryBtn} disabled={step === 0} onClick={() => { blurNow(); setStep(step - 1) }}>Back</button>
            <button type="button" className={primaryBtn} onClick={() => { blurNow(); setStep(step + 1) }}>{step === sections.length - 1 ? "Review" : "Continue"}</button>
          </div>
        ) : null}
      </div>
    </Frame>
  )
}

/** Show a client-side error only once the applicant has typed in the field or the server has reported it, so a fresh form is not covered in red. */
function touchedError(id: string, answers: Answers, serverErrors: Record<string, string>): boolean {
  const v = answers[id]
  return serverErrors[id] !== undefined || (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
}

function legalName(view: ApplicantView, answers: Answers): string {
  const f = typeof answers["identity.legal_first_name"] === "string" ? (answers["identity.legal_first_name"] as string) : ""
  const l = typeof answers["identity.legal_last_name"] === "string" ? (answers["identity.legal_last_name"] as string) : ""
  return (f || l ? `${f} ${l}` : view.applicantName).trim()
}

function Frame({ children, company }: { children: React.ReactNode; company?: string }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-[#F8FAFC] to-[#EEF2F7] px-4 pb-10 pt-5 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <DriverApplicationBrandHeader companyName={company} />
        {children}
        <DriverApplicationFooter />
      </div>
    </main>
  )
}

function ConsentCard({ consent, accepted, legalName, onAccepted }: { consent: ApplicantView["plan"]["consents"][number]; accepted?: ApplicantView["consents"][number]; legalName: string; onAccepted: () => void }) {
  const [shown, setShown] = useState<PresentedConsent | null>(null)
  const [name, setName] = useState("")
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const pending = consent.legalStatus === "PENDING_LEGAL_REVIEW"

  async function open() {
    setBusy(true)
    setMessage(null)
    try {
      setShown(await api<PresentedConsent>("/api/driver-applications/consents/present", { method: "POST", json: { key: consent.key } }))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not open this authorization.")
    } finally {
      setBusy(false)
    }
  }
  async function sign() {
    setBusy(true)
    setMessage(null)
    try {
      await api("/api/driver-applications/consents/accept", { method: "POST", json: { key: consent.key, signatureName: name, affirmed: agree } })
      onAccepted()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not record your signature.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3 rounded-2xl border border-[#CBD5E1] bg-[#F8FAFC] p-4 sm:p-5">
      <h2 className="text-base font-bold text-[#0B1F44]">{consent.title}</h2>
      {consent.external ? (
        <p className="text-sm leading-6 text-[#475569]">{consent.purpose} This is completed through a separate official process. The company will guide you; you do not sign it here.</p>
      ) : accepted ? (
        <p className="text-sm font-semibold text-[#166534]">Signed by {accepted.signatureName} on {new Date(accepted.acceptedAt).toLocaleString()}.</p>
      ) : !shown ? (
        <>
          <p className="text-sm leading-6 text-[#475569]">{consent.purpose}</p>
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => void open()}>Read and sign</button>
        </>
      ) : (
        <>
          {pending ? <p role="note" className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5 text-sm text-[#78350F]">This wording is still with legal review. Your signature will be recorded, but the company cannot rely on it until the wording is approved.</p> : null}
          <div tabIndex={0} aria-label={`${consent.title} text`} className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#E2E8F0] bg-white p-4 text-sm leading-6 text-[#0F172A]">{shown.text}</div>
          <label className="flex items-start gap-3 text-sm text-[#0F172A]">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[#0B1F44]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            I have read this authorization and I agree to it.
          </label>
          <div>
            <label htmlFor={`sig-${consent.key}`} className="block text-sm font-semibold text-[#0B1F44]">Type your full legal name to sign</label>
            <input id={`sig-${consent.key}`} autoComplete="off" className="mt-1.5 w-full rounded-xl border border-[#CBD5E1] bg-white px-3.5 py-3 text-base outline-none focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/15" value={name} onChange={(e) => setName(e.target.value)} placeholder={legalName} />
          </div>
          <button type="button" className={primaryBtn} disabled={busy || !agree || !name.trim()} onClick={() => void sign()}>{busy ? "Recording…" : "Sign"}</button>
        </>
      )}
      {message ? <p role="alert" className="text-sm font-medium text-[#B91C1C]">{message}</p> : null}
    </div>
  )
}
