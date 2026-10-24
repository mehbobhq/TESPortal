"use client"

import Image from "next/image"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, Briefcase, Check, CheckCircle2, ClipboardList, CreditCard, FileUp, ListChecks, LogOut, MapPin, PenLine, Save, Truck, User } from "lucide-react"
import { evalCond } from "@/lib/driver-application/conditions"
import { applicableFields, validateAnswers, type Answers } from "@/lib/driver-application/validate"
import type { ApplicantView, PresentedConsent } from "@/lib/driver-application/applicant-service"
import { ApiError, api, getCsrf, setCsrf } from "./api-client"
import { FieldControl, ghostBtn, isWideField, primaryBtn, secondaryBtn } from "./FieldControls"
import { heroBackground } from "./design"

type Phase = "loading" | "invalid" | "welcome" | "form" | "exited" | "receipt"
type SaveState = "idle" | "saving" | "saved" | "error" | "conflict"

/** The invitation secret travels in the URL fragment only: fragments are never sent to a server, logged, or forwarded in Referer headers. */
function readSecret(): string | null {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("k")
}

const SECTION_ICON: Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  identity: User, address: MapPin, licence: CreditCard, experience: Truck, employment: Briefcase, hr: ClipboardList, eligibility: ListChecks, documents: FileUp, authorizations: PenLine,
}

export default function ApplicantApp() {
  const [phase, setPhase] = useState<Phase>("loading")
  const [view, setView] = useState<ApplicantView | null>(null)
  const [answers, setAnswers] = useState<Answers>({})
  const [save, setSave] = useState<SaveState>("idle")
  const [step, setStep] = useState(0)
  const [attempted, setAttempted] = useState<Set<string>>(new Set())
  const [serverErrors, setServerErrors] = useState<{ errors: Record<string, string>; itemErrors: Record<string, Array<Record<string, string>>> }>({ errors: {}, itemErrors: {} })
  const [receipt, setReceipt] = useState<{ receiptId: string; submittedAt: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const dirty = useRef<Set<string>>(new Set())
  const versionRef = useRef(0)
  const answersRef = useRef<Answers>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const load = useCallback(async (): Promise<ApplicantView> => {
    const v = await api<ApplicantView>("/api/driver-applications/application")
    setView(v)
    setAnswers(v.answers)
    answersRef.current = v.answers
    versionRef.current = v.answersVersion
    return v
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
        const v = await load()
        if (cancelled) return
        if (v.application.status === "SUBMITTED") {
          setReceipt({ receiptId: v.application.receiptId ?? "", submittedAt: v.application.submittedAt ?? "" })
          setPhase("receipt")
        } else {
          // Returning applicants who already started go straight back to their form.
          setPhase(Object.keys(v.answers).length > 0 ? "form" : "welcome")
        }
      } catch {
        if (!cancelled) setPhase("invalid")
      }
    })()
    return () => { cancelled = true }
  }, [load])

  /** Saves are strictly one at a time: a second save starts only after the first returned its new version, so quick typing never races itself into a false conflict. */
  const chain = useRef<Promise<void>>(Promise.resolve())
  const flush = useCallback((): Promise<void> => {
    const run = async () => {
      if (dirty.current.size === 0) return
      const keys = [...dirty.current]
      dirty.current = new Set()
      setSave("saving")
      try {
        const patch: Answers = {}
        for (const k of keys) patch[k] = answersRef.current[k] ?? null
        const r = await api<{ version: number; errors: Record<string, string>; itemErrors: Record<string, Array<Record<string, string>>> }>("/api/driver-applications/draft", { method: "PATCH", json: { version: versionRef.current, patch } })
        versionRef.current = r.version
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
    }
    chain.current = chain.current.then(run, run)
    return chain.current
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
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current.size) e.preventDefault() }
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

  const sectionIssues = useCallback((s: (typeof sections)[number]) => {
    if (!live) return 0
    const ids = s.fields.map((f) => f.field.id)
    const n = ids.filter((id) => live.errors[id] || live.itemErrors[id]?.some((r) => Object.keys(r).length)).length
    return n + (s.section.id === "authorizations" ? live.missingConsents.length : 0)
  }, [live])
  const started = (s: (typeof sections)[number]) => s.fields.some((f) => { const v = answers[f.field.id]; return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0) }) || (view?.uploads.some((u) => s.fields.some((f) => f.field.id === u.fieldId)) ?? false) || (s.section.id === "authorizations" && (view?.consents.length ?? 0) > 0)

  const totalSteps = sections.length + 1 // + review
  useEffect(() => { if (phase === "form") headingRef.current?.focus({ preventScroll: false }) }, [step, phase])

  async function go(next: number) {
    blurNow()
    const leaving = sections[step]
    if (leaving) setAttempted((a) => new Set(a).add(leaving.section.id))
    setStep(Math.max(0, Math.min(next, totalSteps - 1)))
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
  }

  async function submit() {
    setSubmitting(true)
    setBanner(null)
    setAttempted(new Set(sections.map((s) => s.section.id)))
    try {
      if (timer.current) clearTimeout(timer.current)
      await flush()
      const r = await api<{ receiptId: string; submittedAt: string }>("/api/driver-applications/submit", { method: "POST", json: {} })
      setReceipt(r)
      setPhase("receipt")
      window.scrollTo({ top: 0 })
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setBanner("Some answers still need attention. They are marked below.")
      else setBanner(e instanceof Error ? e.message : "The application could not be submitted.")
    } finally {
      setSubmitting(false)
    }
  }

  async function saveAndExit() {
    if (timer.current) clearTimeout(timer.current)
    await flush()
    setPhase("exited")
    window.scrollTo({ top: 0 })
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  if (phase === "loading") return <Page><p role="status" className="py-32 text-center text-[#5B6B82]">Opening your application…</p></Page>
  if (phase === "invalid" || !view) {
    return (
      <Page>
        <Card className="mx-auto mt-16 max-w-md text-center">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-[#0B1F44] outline-none">This link can’t be used</h1>
          <p className="mt-3 leading-7 text-[#5B6B82]">The link may have expired or been replaced. Ask the company that invited you to send a new application link.</p>
        </Card>
      </Page>
    )
  }
  const company = view.companyName
  const locked = view.application.status !== "DRAFT"
  const firstName = (view.applicantName || "").split(" ")[0]

  if (phase === "receipt" && receipt) {
    return (
      <Page company={company}>
        <Card className="mx-auto mt-10 max-w-xl text-center">
          <div aria-hidden className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#EAF2FF] text-[#1D4ED8]"><CheckCircle2 className="h-9 w-9" /></div>
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-[#0B1F44] outline-none sm:text-3xl">Application received</h1>
          <p className="mt-3 leading-7 text-[#475569]">Thank you{firstName ? `, ${firstName}` : ""}. {company} will review your application. Receiving it is not a hiring decision, and nothing in it has been verified yet.</p>
          <dl className="mx-auto mt-7 grid max-w-sm gap-4 rounded-2xl border border-[#D6E2F5] bg-[#F7FAFF] p-5 text-left text-sm">
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-[#5B6B82]">Receipt number</dt><dd className="mt-1 break-all font-mono text-[15px] text-[#0B1F44]">{receipt.receiptId}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-[#5B6B82]">Received</dt><dd className="mt-1 text-[15px] text-[#0B1F44]">{receipt.submittedAt ? new Date(receipt.submittedAt).toLocaleString() : ""}</dd></div>
          </dl>
          <p className="mt-6 text-sm leading-6 text-[#5B6B82]">Keep this receipt number if you need to refer to your application. You can close this page.</p>
        </Card>
      </Page>
    )
  }

  if (phase === "exited") {
    return (
      <Page company={company}>
        <Card className="mx-auto mt-10 max-w-xl text-center">
          <div aria-hidden className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#EAF2FF] text-[#1D4ED8]"><Save className="h-8 w-8" /></div>
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-[#0B1F44] outline-none">Your progress is saved</h1>
          <p className="mt-3 leading-7 text-[#475569]">Open the link in your invitation email whenever you are ready and you will continue where you stopped. Your answers are stored securely on the company’s application, not in this browser.</p>
          <div className="mt-6"><button type="button" className={primaryBtn} onClick={() => setPhase("form")}>Return to my application</button></div>
        </Card>
      </Page>
    )
  }

  if (phase === "welcome") {
    const uploadFields = applicable.filter((a) => a.field.type === "upload")
    const years = view.plan.context.historyYears
    const addressYears = view.plan.fields.find((f) => f.id === "address.history")?.validation?.coverageYears
    const signable = view.plan.consents.filter((c) => !c.external).length
    const hasExternal = view.plan.consents.some((c) => c.external)
    return (
      <Page company={company} welcome>
        <section aria-labelledby="welcome-title" className="relative overflow-hidden rounded-3xl text-white shadow-[0_30px_60px_-30px_rgba(11,31,68,0.7)]" style={{ backgroundImage: `linear-gradient(105deg, rgba(11,31,68,0.94) 0%, rgba(11,31,68,0.82) 46%, rgba(11,31,68,0.35) 100%), ${heroBackground()}`, backgroundSize: "cover", backgroundPosition: "center" }}>
          <div className="px-6 py-12 sm:px-12 sm:py-16 lg:max-w-[62%]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9CC0FF]">Driver application</p>
            <h1 id="welcome-title" ref={headingRef} tabIndex={-1} className="mt-3 text-3xl font-bold leading-tight tracking-tight outline-none sm:text-5xl">{firstName ? `Welcome, ${firstName}.` : "Welcome."}</h1>
            <p className="mt-4 text-lg leading-8 text-[#DCE8FB]">{company} has invited you to complete its driver application. It takes a few sections, saves as you go, and you can stop and come back at any time.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button type="button" className={`${primaryBtn} !min-h-14 !px-8 !text-base`} onClick={() => { setPhase("form"); window.scrollTo({ top: 0 }) }}>
                {Object.keys(answers).length ? "Continue my application" : "Start my application"}<ArrowRight aria-hidden className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Card>
            <h2 className="text-lg font-bold text-[#0B1F44]">What to have ready</h2>
            <ul className="mt-4 space-y-3 text-[15px] leading-6 text-[#334155]">
              <Bullet>Your driver’s licence details{uploadFields.some((u) => u.field.id.includes("licence")) ? " and clear photos of the front and back" : ""}.</Bullet>
              {addressYears ? <Bullet>Where you have lived over the last {addressYears} years.</Bullet> : null}
              <Bullet>Your employers over the last {years} years, with their contact details and dates.</Bullet>
              {uploadFields.length ? <Bullet>Documents you may be asked to upload: {uploadFields.map((u) => u.field.label.toLowerCase()).join(", ")}.</Bullet> : null}
            </ul>
          </Card>
          <Card>
            <h2 className="text-lg font-bold text-[#0B1F44]">How it works</h2>
            <ul className="mt-4 space-y-3 text-[15px] leading-6 text-[#334155]">
              <Bullet>Your answers save automatically. Use “Save &amp; exit” to leave and return with the same link.</Bullet>
              <Bullet>Only the questions that apply to your situation are shown.</Bullet>
              {signable ? <Bullet>{signable} authorization{signable === 1 ? "" : "s"} {signable === 1 ? "is" : "are"} read and signed separately, each with its stated purpose.</Bullet> : null}
              {hasExternal ? <Bullet>Some checks are completed through a separate official process. The company will guide you.</Bullet> : null}
              <Bullet>You review everything before you submit. Submitting is not a hiring decision.</Bullet>
            </ul>
          </Card>
        </div>
      </Page>
    )
  }

  // ---- form ----------------------------------------------------------------------------------------------------------------------
  const isReview = step >= sections.length
  const current = sections[Math.min(step, sections.length - 1)]
  const progress = Math.round((Math.min(step, totalSteps - 1) / Math.max(1, totalSteps - 1)) * 100)
  const itemErrorsOf = (id: string) => (live?.itemErrors[id] ?? serverErrors.itemErrors[id])
  const showError = (id: string, sectionId: string) => (attempted.has(sectionId) || touched(answers[id]) || serverErrors.errors[id] !== undefined ? live?.errors[id] ?? serverErrors.errors[id] : serverErrors.errors[id])
  const stepTitles = [...sections.map((s) => s.section.title), "Review"]
  const saveText = save === "saving" ? "Saving…" : save === "saved" ? "All changes saved" : save === "error" ? "Not saved — check your connection" : save === "conflict" ? "Reload needed" : ""

  return (
    <Page company={company} onSaveExit={() => void saveAndExit()}>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 rounded-2xl border border-[#D6E2F5] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-[#0B1F44]">Step {Math.min(step + 1, totalSteps)} of {totalSteps}<span className="hidden text-[#5B6B82] sm:inline"> · {stepTitles[Math.min(step, stepTitles.length - 1)]}</span></span>
            <span role="status" aria-live="polite" className={`text-xs font-medium ${save === "error" || save === "conflict" ? "text-[#B91C1C]" : "text-[#5B6B82]"}`}>{saveText}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#E3ECF9]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Application progress">
            <div className="h-full rounded-full bg-gradient-to-r from-[#1D4ED8] to-[#3B82F6] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.max(progress, 5)}%` }} />
          </div>
          <ol className="mt-4 hidden flex-wrap gap-2 lg:flex" aria-label="Sections">
            {stepTitles.map((t, i) => {
              const s = sections[i]
              const done = s ? started(s) && sectionIssues(s) === 0 : false
              return (
                <li key={t}>
                  <button type="button" onClick={() => void go(i)} aria-current={i === step ? "step" : undefined} className={`inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition motion-reduce:transition-none focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1D4ED8]/30 ${i === step ? "bg-[#0B1F44] text-white" : "bg-[#EEF3FB] text-[#334155] hover:bg-[#DFE9F8]"}`}>
                    {done && i !== step ? <Check aria-hidden className="h-3.5 w-3.5 text-[#1D4ED8]" /> : null}{t}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>

        {banner ? <div role="alert" className="mb-5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm font-medium text-[#991B1B]">{banner}</div> : null}

        {!isReview && current ? (
          <section aria-labelledby="step-title" key={current.section.id} className="space-y-5 motion-safe:animate-[fadeUp_.35s_ease-out]">
            <header className="flex items-start gap-4">
              {(() => { const Icon = SECTION_ICON[current.section.id] ?? ClipboardList; return <span aria-hidden className="mt-1 hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EAF2FF] text-[#1D4ED8] sm:flex"><Icon className="h-6 w-6" /></span> })()}
              <div>
                <h1 id="step-title" ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-[#0B1F44] outline-none sm:text-3xl">{current.section.title}</h1>
                <p className="mt-1.5 text-[15px] leading-7 text-[#5B6B82]">{current.section.intro}</p>
              </div>
            </header>
            <Card>
              <div className="grid gap-x-6 gap-y-7 md:grid-cols-2">
                {current.fields.map(({ field, required }) => (
                  <div key={field.id} className={isWideField(field) ? "md:col-span-2" : ""}>
                    <FieldControl
                      field={field}
                      required={required}
                      value={answers[field.id]}
                      error={showError(field.id, current.section.id)}
                      itemErrors={attempted.has(current.section.id) || serverErrors.itemErrors[field.id] ? itemErrorsOf(field.id) : undefined}
                      uploads={view.uploads}
                      sensitiveCollected={view.sensitiveCollected.includes(field.id)}
                      locked={locked}
                      onChange={(v) => change(field.id, v)}
                      onBlur={blurNow}
                      onUploaded={() => void flush().then(load)}
                    />
                  </div>
                ))}
              </div>
              {current.consents.length ? (
                <div className="mt-2 space-y-4">
                  {current.consents.map((c) => (
                    <ConsentCard key={`${c.key}@${c.version}`} consent={c} accepted={view.consents.find((a) => a.key === c.key && a.version === c.version && a.textSha256 === c.textSha256)} legalName={legalName(view, answers)} onAccepted={() => void flush().then(load)} />
                  ))}
                </div>
              ) : null}
            </Card>
          </section>
        ) : (
          <section aria-labelledby="step-title" className="space-y-5 motion-safe:animate-[fadeUp_.35s_ease-out]">
            <header>
              <h1 id="step-title" ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-[#0B1F44] outline-none sm:text-3xl">Review and submit</h1>
              <p className="mt-1.5 text-[15px] leading-7 text-[#5B6B82]">Check each part. When you submit, your answers are locked and sent to {company}. Submitting is not a hiring decision, and nothing is treated as verified until the company verifies it.</p>
            </header>
            <ul className="divide-y divide-[#E3ECF9] overflow-hidden rounded-2xl border border-[#D6E2F5] bg-white shadow-sm">
              {sections.map((s, i) => {
                const issues = sectionIssues(s)
                const Icon = SECTION_ICON[s.section.id] ?? ClipboardList
                return (
                  <li key={s.section.id} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                    <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${issues ? "bg-[#FEF2F2] text-[#B91C1C]" : "bg-[#EAF2FF] text-[#1D4ED8]"}`}>{issues ? <Icon className="h-5 w-5" /> : <Check className="h-5 w-5" />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[#0B1F44]">{s.section.title}</div>
                      <div className={`text-sm ${issues ? "font-medium text-[#B91C1C]" : "text-[#5B6B82]"}`}>{issues ? `${issues} item${issues === 1 ? "" : "s"} need${issues === 1 ? "s" : ""} attention` : "Answered"}</div>
                    </div>
                    <button type="button" className={secondaryBtn} onClick={() => void go(i)}>{issues ? "Fix" : "Edit"}</button>
                  </li>
                )
              })}
            </ul>
            {view.plan.regulatoryReviewRequirements.length ? (
              <p className="rounded-xl border border-[#D6E2F5] bg-[#F7FAFF] px-4 py-3 text-sm leading-6 text-[#475569]">Some checks for your situation need the company’s own review. You do not need to do anything about them now.</p>
            ) : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <button type="button" className={secondaryBtn} onClick={() => void go(sections.length - 1)}><ArrowLeft aria-hidden className="h-4 w-4" />Back</button>
              <button type="button" className={`${primaryBtn} !min-h-14 !px-8`} disabled={submitting || locked || save === "conflict"} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit application"}</button>
            </div>
          </section>
        )}

        {!isReview ? (
          <nav aria-label="Step navigation" className="mt-6 flex items-center justify-between gap-3">
            <button type="button" className={secondaryBtn} disabled={step === 0} onClick={() => void go(step - 1)}><ArrowLeft aria-hidden className="h-4 w-4" />Back</button>
            <button type="button" className={primaryBtn} onClick={() => void go(step + 1)}>{step === sections.length - 1 ? "Review" : "Continue"}<ArrowRight aria-hidden className="h-4 w-4" /></button>
          </nav>
        ) : null}
      </div>
    </Page>
  )
}

const touched = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)

function legalName(view: ApplicantView, answers: Answers): string {
  const f = typeof answers["identity.legal_first_name"] === "string" ? (answers["identity.legal_first_name"] as string) : ""
  const l = typeof answers["identity.legal_last_name"] === "string" ? (answers["identity.legal_last_name"] as string) : ""
  return (f || l ? `${f} ${l}` : view.applicantName).trim()
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-[#D6E2F5] bg-white p-5 shadow-[0_12px_30px_-18px_rgba(11,31,68,0.25)] sm:p-8 ${className}`}>{children}</div>
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#1D4ED8]" />
      <span>{children}</span>
    </li>
  )
}

function Page({ children, company, welcome, onSaveExit }: { children: React.ReactNode; company?: string; welcome?: boolean; onSaveExit?: () => void }) {
  return (
    <div className="min-h-screen bg-[#F3F7FE] bg-[radial-gradient(1200px_500px_at_50%_-10%,#E3EEFF_0%,transparent_70%)] text-[#0B1F44]">
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
      <header className="sticky top-0 z-20 border-b border-[#D6E2F5] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Image src="/branding/TES-Logo.png" alt="TES — Compliance Simplified" width={420} height={180} priority className="h-9 w-auto shrink-0 object-contain sm:h-10" />
            {company ? (
              <>
                <span aria-hidden className="hidden h-7 w-px bg-[#D6E2F5] sm:block" />
                <div className="min-w-0">
                  <div className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5B6B82] sm:block">Driver application</div>
                  <div className="truncate text-sm font-bold text-[#0B1F44] sm:text-[15px]">{company}</div>
                </div>
              </>
            ) : null}
          </div>
          {onSaveExit ? <button type="button" className={`${ghostBtn} !min-h-11 !px-3 sm:!px-4`} onClick={onSaveExit}><LogOut aria-hidden className="h-4 w-4" /><span className="sm:inline">Save &amp; exit</span></button> : null}
        </div>
      </header>
      <main className={`mx-auto max-w-5xl px-4 pb-14 sm:px-6 ${welcome ? "pt-6 sm:pt-8" : "pt-6 sm:pt-8"}`}>{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-center sm:px-6">
        <div className="border-t border-[#D6E2F5] pt-6 text-xs text-[#5B6B82]">
          <div className="font-semibold text-[#334155]">Powered by TES</div>
          <div className="mt-1 uppercase tracking-[0.18em]">Trucking Compliance Simplified</div>
        </div>
      </footer>
    </div>
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
    <div className="space-y-3 rounded-2xl border border-[#BFD3F5] bg-[#F7FAFF] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold text-[#0B1F44]">{consent.title}</h2>
        {accepted ? <span className="rounded-full bg-[#EAF2FF] px-2.5 py-0.5 text-xs font-semibold text-[#1D4ED8]">Signed</span> : null}
      </div>
      {consent.external ? (
        <p className="text-sm leading-6 text-[#475569]">{consent.purpose} This is completed through a separate official process. The company will guide you; you do not sign it here.</p>
      ) : accepted ? (
        <p className="text-sm font-medium text-[#334155]">Signed by {accepted.signatureName} on {new Date(accepted.acceptedAt).toLocaleString()}.</p>
      ) : !shown ? (
        <>
          <p className="text-sm leading-6 text-[#475569]">{consent.purpose}</p>
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => void open()}>Read and sign</button>
        </>
      ) : (
        <>
          {pending ? <p role="note" className="rounded-xl border border-[#F2D58A] bg-[#FFF8E1] px-3.5 py-2.5 text-sm leading-6 text-[#78350F]">This wording is still with legal review. Your signature will be recorded, but the company cannot rely on it until the wording is approved.</p> : null}
          <div tabIndex={0} aria-label={`${consent.title} text`} className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#D6E2F5] bg-white p-4 text-sm leading-7 text-[#0F172A] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1D4ED8]/25">{shown.text}</div>
          <label className="flex min-h-11 items-start gap-3 text-[15px] leading-6 text-[#0F172A]">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[#1D4ED8]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            I have read this authorization and I agree to it.
          </label>
          <div>
            <label htmlFor={`sig-${consent.key}`} className="block text-[15px] font-semibold text-[#0B1F44]">Type your full legal name to sign</label>
            <input id={`sig-${consent.key}`} autoComplete="off" className="mt-2 min-h-12 w-full rounded-xl border border-[#C9D6EA] bg-white px-3.5 py-3 text-base outline-none focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/15" value={name} onChange={(e) => setName(e.target.value)} placeholder={legalName} />
          </div>
          <button type="button" className={primaryBtn} disabled={busy || !agree || !name.trim()} onClick={() => void sign()}>{busy ? "Recording…" : "Sign"}</button>
        </>
      )}
      {message ? <p role="alert" className="text-sm font-medium text-[#B91C1C]">{message}</p> : null}
    </div>
  )
}
