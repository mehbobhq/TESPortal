"use client"

// RESTORED original Settings (Compliance Profile) workspace: six sections, ~45 rules with Applies / Doesn't apply / Not configured,
// minimum driver age and experience, a jurisdiction filter, a draft with Save / Discard, a "Saved at" chip and an unsaved-changes
// confirmation. It is wired to the canonical company-profile domain through ./adapter instead of browser storage: "Save profile"
// is a batch of canonical operations with a result for every item (a failure is shown, never swallowed).

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { Check, ChevronRight, CircleHelp, Info, X, AlertTriangle } from "lucide-react"

import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { EmptyState, LoadingState } from "@/src/components/shared/StateDisplays"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { CompanyProfileView } from "@/lib/company-profile/types"
import { getRuleDefinition } from "@/lib/company-profile/definitions"

import { RULES, type Rule, type RuleValue } from "./rules"
import { SECTIONS } from "./sections"
import {
  SCOPE_CHOICES,
  SettingsRequestError,
  cloneSettings,
  fetchSettingsTransport,
  jurisdictionOf,
  planSave,
  reconcileDraft,
  ruleCode,
  runPlan,
  settingsDirty,
  toSettingsState,
  touchesRecordedFacts,
  type ItemResult,
  type RecordAs,
  type SettingsState,
  type SettingsTransport,
} from "./adapter"

type CompanyFacts = { regCorpCountry: string | null; regCorpState: string | null; opRegion: string | null } | "unavailable" | null
type CompanySummary = { id: string; name: string; kind?: string; status?: string }

function CompanyFact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-sm font-medium">{value || "Not recorded"}</p>
    </div>
  )
}

function RadioChoice({
  name,
  value,
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  name: string
  value: string
  checked: boolean
  onChange: () => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <label
      className={[
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all",
        checked ? "border-foreground/30 bg-muted/70" : "border-border hover:bg-muted/40",
      ].join(" ")}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} className="mt-1 h-4 w-4 accent-foreground" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  )
}

function RuleRow({ rule, value, onChange, disabled, defaultNote }: { rule: Rule; value: RuleValue; onChange: (value: RuleValue) => void; disabled: boolean; defaultNote: string | null }) {
  return (
    <div className={["border-b last:border-b-0 py-5", disabled ? "opacity-50" : ""].join(" ")}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-center">
        <div>
          <div className="text-sm font-medium">{rule.title}</div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{rule.description}</p>
          {defaultNote ? <p className="mt-1 text-[11px] text-muted-foreground">{defaultNote}</p> : null}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <RadioChoice name={rule.id} value="applies" checked={value === "applies"} onChange={() => onChange("applies")} label="Applies" />
          <RadioChoice name={rule.id} value="does-not-apply" checked={value === "does-not-apply"} onChange={() => onChange("does-not-apply")} label="Doesn't apply" />
          <RadioChoice name={rule.id} value="not-configured" checked={value === "not-configured"} onChange={() => onChange("not-configured")} label="Not configured" />
        </div>
      </div>
    </div>
  )
}

export function RestoredSettings({ companyId, transport: injected }: { companyId: string; transport?: SettingsTransport }) {
  const transport = useMemo(() => injected ?? fetchSettingsTransport(companyId), [companyId, injected])

  const [company, setCompany] = useState<CompanySummary | null>(null)
  const [facts, setFacts] = useState<CompanyFacts>(null)
  const [view, setView] = useState<CompanyProfileView | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [companyMissing, setCompanyMissing] = useState(false)
  const [activeSection, setActiveSection] = useState("overview")
  const [savedSettings, setSavedSettings] = useState<SettingsState | null>(null)
  const [draftSettings, setDraftSettings] = useState<SettingsState | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [results, setResults] = useState<ItemResult[]>([])
  const [saving, setSaving] = useState(false)
  const [recordAs, setRecordAs] = useState<RecordAs>("change")

  const adopt = useCallback((next: CompanyProfileView) => {
    const state = toSettingsState(next)
    setView(next)
    setSavedSettings(cloneSettings(state))
    return state
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/summary`, { cache: "no-store" })
        if (response.status === 404) {
          if (!cancelled) setCompanyMissing(true)
          return
        }
        if (!response.ok) throw new SettingsRequestError("The company could not be loaded. This is a temporary error, not a missing company.")
        const summary = (await response.json())?.company ?? { id: companyId, name: "Company" }
        const next = await transport.read()
        // The company facts are read from the existing company record; a failure is shown as unavailable, never as "Not recorded".
        let loadedFacts: CompanyFacts = "unavailable"
        try {
          const profile = await fetch(`/api/companies/${encodeURIComponent(companyId)}/profile`, { cache: "no-store" })
          if (profile.ok) {
            const body = (await profile.json())?.company
            loadedFacts = { regCorpCountry: body?.regCorpCountry ?? null, regCorpState: body?.regCorpState ?? null, opRegion: body?.opRegion ?? null }
          }
        } catch {
          loadedFacts = "unavailable"
        }
        if (cancelled) return
        setCompany(summary)
        setFacts(loadedFacts)
        setDraftSettings(cloneSettings(adopt(next)))
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Settings could not be loaded.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyId, transport, adopt])

  const isDirty = useMemo(() => (savedSettings && draftSettings ? settingsDirty(savedSettings, draftSettings) : false), [savedSettings, draftSettings])

  // Leaving the page with unsaved changes asks first (the original asked on Back; a tab close or reload is guarded the same way).
  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isDirty])

  const configuredCount = useMemo(() => (draftSettings ? Object.values(draftSettings.rules).filter((value) => value !== "not-configured").length : 0), [draftSettings])
  const totalRules = draftSettings ? Object.keys(draftSettings.rules).length : 0
  const activeRules = useMemo(() => (activeSection === "overview" ? [] : RULES[activeSection] || []), [activeSection])
  const jurisdiction = draftSettings ? jurisdictionOf(draftSettings.scope) : null

  const updateRule = (id: string, value: RuleValue) => {
    setSaveMessage(null)
    setDraftSettings((current) => (current ? { ...current, rules: { ...current.rules, [id]: value } } : current))
  }

  const plan = useMemo(() => (view && savedSettings && draftSettings ? planSave(view, savedSettings, draftSettings, recordAs) : []), [view, savedSettings, draftSettings, recordAs])
  const showRecordAs = view && savedSettings && draftSettings ? touchesRecordedFacts(view, savedSettings, draftSettings) : false

  const handleSave = async () => {
    if (!view || !savedSettings || !draftSettings || saving) return
    setSaving(true)
    setSaveMessage(null)
    try {
      const outcome = await runPlan(transport, plan)
      let fresh: CompanyProfileView
      try {
        fresh = await transport.read()
      } catch (error) {
        // The operations ran but the record could not be re-read: keep the draft, say so, and do not claim a clean save.
        setResults([...outcome, { key: "refresh", label: "Reloading the saved profile", status: "failed", message: error instanceof Error ? error.message : "The profile could not be reloaded." }])
        setSaveMessage("Some changes may have been saved, but the profile could not be reloaded. Reload the page to see what is recorded.")
        return
      }
      const freshState = adopt(fresh)
      setDraftSettings(reconcileDraft(freshState, draftSettings, outcome))
      setResults(outcome)
      const failed = outcome.filter((item) => item.status !== "saved")
      if (failed.length === 0) {
        setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))
        setSaveMessage("Compliance profile saved.")
      } else {
        setSaveMessage(`${outcome.length - failed.length} of ${outcome.length} change${outcome.length === 1 ? "" : "s"} saved. ${failed.length} could not be saved and ${failed.length === 1 ? "is" : "are"} still unsaved below.`)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    if (savedSettings) setDraftSettings(cloneSettings(savedSettings))
    setSaveMessage(null)
    setResults([])
  }

  if (loading) return <div className="p-10"><LoadingState message="Loading company settings..." /></div>

  if (companyMissing) {
    return (
      <div className="p-10 text-center">
        <h1 className="text-lg font-semibold">Company Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground">The company associated with this settings page could not be found.</p>
      </div>
    )
  }

  if (loadError || !company || !draftSettings || !savedSettings || !view) {
    return (
      <div className="p-6">
        <EmptyState title="Settings could not be opened" description={loadError ?? "Settings could not be loaded."} action={{ label: "Reload", onClick: () => window.location.reload() }} />
      </div>
    )
  }

  const failedResults = results.filter((item) => item.status !== "saved")

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col pb-12">
      {/* HEADER */}
      <div className="border-b pb-6">
        <CompanyWorkspaceHeader
          company={{ id: company.id, name: company.name, kind: company.kind || "", status: company.status || "" }}
          section="Compliance Profile"
          actions={
            !isDirty && savedAt ? (
              <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
                <Check className="size-3" />
                Saved {savedAt}
              </span>
            ) : undefined
          }
        />

        <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
          Tell TES which compliance rules actually apply to this company. These choices shape the alerts, document requirements, and compliance checks the system generates.
        </p>
      </div>

      {/* MAIN LAYOUT */}
      <div className="grid min-h-[620px] lg:grid-cols-[230px_minmax(0,1fr)]">
        {/* LEFT NAV */}
        <aside className="border-b py-5 lg:border-b-0 lg:border-r lg:pr-5">
          <div className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Compliance profile</div>

          <nav className="space-y-1">
            {SECTIONS.map((section) => {
              const Icon = section.icon
              const active = activeSection === section.id

              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(section.id)
                    setSaveMessage(null)
                  }}
                  className={[
                    "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="size-4 shrink-0" />

                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{section.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{section.description}</span>
                  </span>

                  {active ? <ChevronRight className="size-3.5" /> : null}
                </button>
              )
            })}
          </nav>

          <div className="mt-6 rounded-lg border bg-muted/20 p-3">
            <div className="text-xs font-medium">Profile coverage</div>
            <div className="mt-2 text-2xl font-semibold">
              {configuredCount}
              <span className="text-sm font-normal text-muted-foreground"> / {totalRules}</span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Rules have an explicit answer.</p>
          </div>
        </aside>

        {/* CONTENT */}
        <main className="min-w-0 py-6 lg:pl-7">
          {activeSection === "overview" ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Company profile</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  TES uses the same registered origin and operating-region fields already connected across the company record. This page does not create a second source of truth.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Company master facts</CardTitle>
                  <CardDescription>
                    These values are read from the existing Company record. Registered origin comes from the corporate identity; the operating region is the operating scope recorded below.
                  </CardDescription>
                </CardHeader>

                <CardContent className="grid gap-4 md:grid-cols-3">
                  {facts === "unavailable" || facts === null ? (
                    <p className="md:col-span-3 text-sm text-muted-foreground">The company master facts could not be loaded. This is a temporary error, not missing data.</p>
                  ) : (
                    <>
                      <CompanyFact label="Registered Country" value={facts.regCorpCountry} />
                      <CompanyFact label="Registered Province / State" value={facts.regCorpState} />
                      <CompanyFact label="Operating Region" value={facts.opRegion} />
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Operating scope</CardTitle>
                  <CardDescription>
                    Decides which Canada-, US-, or cross-border rules are relevant. TES records only what you choose here; it is not guessed from the company region.
                    {draftSettings.scope === null ? " No operating scope has been recorded, so every rule is shown as relevant." : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  {SCOPE_CHOICES.map((choice) => (
                    <RadioChoice
                      key={choice.value}
                      name="operating-scope"
                      value={choice.value}
                      checked={draftSettings.scope === choice.value}
                      onChange={() => {
                        setSaveMessage(null)
                        setDraftSettings((current) => (current ? { ...current, scope: choice.value } : current))
                      }}
                      label={choice.label}
                      description={choice.description}
                    />
                  ))}
                </CardContent>
              </Card>

              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">How the alert engine uses this page</CardTitle>
                  </CardHeader>

                  <CardContent className="space-y-4 text-sm">
                    <div className="flex gap-3">
                      <div className="mt-0.5 rounded-full bg-muted p-1.5">
                        <Check className="size-3.5" />
                      </div>
                      <div>
                        <div className="font-medium">Applies</div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">This is a deliberate Yes. TES should evaluate the requirement for this company.</p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="mt-0.5 rounded-full bg-muted p-1.5">
                        <X className="size-3.5" />
                      </div>
                      <div>
                        <div className="font-medium">Doesn't apply</div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">This is a deliberate No. TES should exclude the requirement from this company's compliance profile.</p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="mt-0.5 rounded-full bg-muted p-1.5">
                        <CircleHelp className="size-3.5" />
                      </div>
                      <div>
                        <div className="font-medium">Not configured</div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">No Yes/No decision has been recorded yet. TES must not interpret an unanswered setting as Doesn't apply.</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-dashed">
                  <CardContent className="flex gap-3 p-5">
                    <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">Why this page exists</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        A compliance system should not warn a company about a requirement that has nothing to do with its operations. Company Settings tell TES what applies; the operational page itself stores the detailed record, credential, filing, document, or transaction.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">{SECTIONS.find((section) => section.id === activeSection)?.label}</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  {activeSection === "tax"
                    ? "Answer only whether each tax applies to this company. Account numbers, filing frequency, return periods, permits, credentials, mileage and tax details belong on the Tax Filing page."
                    : "Mark each requirement explicitly. This prevents an unanswered setting from being interpreted as an operational decision."}
                </p>
              </div>

              {activeSection === "drivers" ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Driver requirements</CardTitle>
                    <CardDescription>Company-level baseline requirements. Individual driver records remain in the Drivers section.</CardDescription>
                  </CardHeader>

                  <CardContent className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="minimumDriverAge">Minimum driver age</Label>
                      <Input
                        id="minimumDriverAge"
                        type="number"
                        min="16"
                        max="100"
                        placeholder="Not recorded"
                        value={draftSettings.minimumDriverAge}
                        onChange={(event) => {
                          setSaveMessage(null)
                          setDraftSettings((current) => (current ? { ...current, minimumDriverAge: event.target.value } : current))
                        }}
                      />
                      <p className="text-[11px] text-muted-foreground">Used when evaluating driver eligibility. {savedSettings.minimumDriverAge === "" ? "No minimum age has been recorded." : ""}</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="minimumDriverExperience">Minimum experience</Label>
                      <Input
                        id="minimumDriverExperience"
                        type="number"
                        min="0"
                        max="600"
                        placeholder="Not recorded"
                        value={draftSettings.minimumDriverExperience}
                        onChange={(event) => {
                          setSaveMessage(null)
                          setDraftSettings((current) => (current ? { ...current, minimumDriverExperience: event.target.value } : current))
                        }}
                      />
                      <p className="text-[11px] text-muted-foreground">Months of driving experience. {savedSettings.minimumDriverExperience === "" ? "No minimum experience has been recorded." : ""}</p>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Applicable requirements</CardTitle>
                  <CardDescription>
                    {activeSection === "tax"
                      ? "Applies = Yes, Doesn't apply = No, and Not configured = no decision recorded yet."
                      : "Choose one answer for every rule that may affect this company's compliance profile."}
                    {jurisdiction === null ? " No operating scope is recorded, so no rule is greyed out by region." : ""}
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-0">
                  {activeRules.map((rule) => {
                    const jurisdictionMatches = rule.appliesTo === "both" || jurisdiction === null || jurisdiction === "both" || rule.appliesTo === jurisdiction
                    const value = draftSettings.rules[rule.id] ?? "not-configured"
                    const definition = getRuleDefinition(ruleCode(rule.id))
                    const defaultNote = value === "not-configured" && definition?.defaultApplicability === "APPLIES" ? "TES assumes this applies until an answer is recorded; that assumption is not a recorded answer." : null

                    return <RuleRow key={rule.id} rule={rule} value={value} disabled={!jurisdictionMatches} defaultNote={defaultNote} onChange={(next) => updateRule(rule.id, next)} />
                  })}
                </CardContent>
              </Card>

              <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
                <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="text-xs leading-5 text-muted-foreground">
                  <span className="font-medium text-foreground">Important:</span>{" "}
                  {activeSection === "tax" ? (
                    <>
                      this section records applicability only. It does not store account numbers, filing frequency, filing periods, due dates, permit type, credentials, mileage, or return details. Those belong on the Tax Filing page.
                    </>
                  ) : (
                    <>
                      choosing <span className="font-medium">Doesn't apply</span> tells TES to intentionally exclude the requirement. Choose <span className="font-medium">Not configured</span> when the company has not made that decision yet.
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* PER-ITEM RESULTS OF THE LAST SAVE: a failure is never hidden */}
      {failedResults.length > 0 ? (
        <div role="alert" className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4" /> Not every change was saved
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Each change is recorded separately, so the others may have been saved. The ones below were not, and are still unsaved in this draft.</p>
          <ul className="mt-2 space-y-1 text-xs">
            {results.map((item) => (
              <li key={item.key} className="flex items-start gap-2">
                {item.status === "saved" ? <Check className="mt-0.5 size-3.5 text-emerald-600" /> : <X className="mt-0.5 size-3.5 text-destructive" />}
                <span>
                  <span className="font-medium">{item.label}</span> — {item.status === "saved" ? "saved" : item.status === "refused" ? `not saved: ${item.message}` : `failed: ${item.message}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* SAVE AREA: ONLY EXISTS WHEN DIRTY */}
      {isDirty ? (
        <div className="mt-6 flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">Unsaved changes</div>
              <p className="text-xs text-muted-foreground">
                Your changes are not active until you save this profile. {plan.length} change{plan.length === 1 ? "" : "s"} will be recorded separately in the company record.
              </p>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleDiscard} disabled={saving}>
                Discard
              </Button>

              <Button type="button" onClick={handleSave} disabled={saving}>
                <Check className="mr-2 size-4" />
                {saving ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </div>

          {showRecordAs ? (
            <fieldset className="rounded-lg border p-3 text-xs">
              <legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">How should changes to recorded answers be saved?</legend>
              <label className="flex items-start gap-2 py-0.5">
                <input type="radio" name="record-as" checked={recordAs === "change"} onChange={() => setRecordAs("change")} className="mt-0.5" />
                <span>A real-world change (the earlier answer stays in history)</span>
              </label>
              <label className="flex items-start gap-2 py-0.5">
                <input type="radio" name="record-as" checked={recordAs === "correct"} onChange={() => setRecordAs("correct")} className="mt-0.5" />
                <span>A correction (the recorded answer was wrong; it is kept and flagged)</span>
              </label>
            </fieldset>
          ) : null}

          {saveMessage ? (
            <p role="status" className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" /> {saveMessage}
            </p>
          ) : null}
        </div>
      ) : saveMessage ? (
        <div className="mt-6 flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <Check className="size-4" />
            {saveMessage}
          </div>

          <button type="button" onClick={() => setSaveMessage(null)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss save message">
            <X className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Route-level entry point: takes the company from the URL. */
export default function RestoredSettingsRoute() {
  const params = useParams()
  return <RestoredSettings companyId={params.id as string} />
}
