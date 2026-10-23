"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Send } from "lucide-react"
import { CompanyMissing } from "@/components/company-missing"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readCompanyLookup } from "@/lib/company-lookup"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import type { ProspectView } from "@/lib/driver-prospects/types"
import { OnboardingChronology } from "./onboarding-chronology"
import * as api from "./prospect-api"
import { OperatingScopeFields, previewScope, scopeFormFrom, toScopeInput, type ScopeFormState } from "./operating-scope-fields"
import { SCOPE_LABEL } from "@/lib/driver-prospects/operating-scope"
import type { PresentationContext } from "@/lib/jurisdiction-context"

type Company = { id: string; name: string; kind: string; status: string }
const blankOnboard = { relationshipType: "EMPLOYEE", relationshipStartDate: "", dateOfBirth: "", licenceCountry: "CA", licenceRegion: "", licenceNumber: "", licenceEffectiveFrom: "", driverNumber: "" }

/**
 * Detail of a driver who is still onboarding (backed by PostgreSQL). Same page frame as the other driver records; the hiring chronology is
 * shown here only, and only while the driver is onboarding. Review and onboarding steps use the existing authorized endpoints.
 */
export function ProspectDriverDetail({ companyId, prospectId }: { companyId: string; prospectId: string }) {
  const router = useRouter()
  const [company, setCompany] = useState<Company | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [prospect, setProspect] = useState<ProspectView | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [application, setApplication] = useState<{ receiptId: string; submittedAt: string; payload: any } | null>(null)
  const [onboarding, setOnboarding] = useState<typeof blankOnboard | null>(null)
  const [email, setEmail] = useState("")
  const [scopeForm, setScopeForm] = useState<ScopeFormState | null>(null)
  const [presentation, setPresentation] = useState<PresentationContext | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await api.listOnboardingDrivers(companyId)
      const found = list.find((p) => p.prospectId === prospectId) ?? null
      setProspect(found)
      setState(found ? "ready" : "missing")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the driver.")
      setState("error")
    }
  }, [companyId, prospectId])

  useEffect(() => {
    void load()
    api.getOnboardingContext(companyId).then(setPresentation).catch(() => setPresentation(null))
    fetch(`/api/companies/${encodeURIComponent(companyId)}/profile`, { cache: "no-store" })
      .then((r) => readCompanyLookup<Company>(r))
      .then((l) => {
        setCompany(l.company)
        setLookupFailed(l.failed)
      })
      .catch(() => setLookupFailed(true))
  }, [companyId, load])

  async function run(work: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setMessage(null)
    try {
      await work()
      setMessage({ tone: "ok", text: ok })
      setOnboarding(null)
      setScopeForm(null)
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "The action could not be completed." })
    } finally {
      setBusy(false)
      await load()
    }
  }

  async function openApplication(kind: "view" | "onboard") {
    setMessage(null)
    try {
      const s = await api.getSubmission(companyId, prospectId)
      if (kind === "view") return setApplication(s)
      const draft = s.payload?.draft ?? {}
      const lic = draft.drivingLicence ?? {}
      const region = typeof lic.jurisdiction === "string" && lic.jurisdiction.trim().length === 2 ? lic.jurisdiction.trim().toUpperCase() : ""
      setOnboarding({ ...blankOnboard, dateOfBirth: draft.aboutYou?.dateOfBirth ?? "", licenceNumber: lic.licenceNumber ?? "", licenceRegion: region, licenceCountry: lic.country === "United States" ? "US" : "CA", licenceEffectiveFrom: lic.issueDate ?? "" })
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Unable to load the application." })
    }
  }

  if (state === "loading") return <div className="p-6 text-sm text-muted-foreground">Loading driver record…</div>
  if (!company && state !== "error") return <CompanyMissing failed={lookupFailed} />
  const back = () => router.push(`/companies/${companyId}/drivers`)
  if (state !== "ready" || !prospect) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">{state === "error" ? "Driver record could not be loaded" : "Driver not found"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{state === "error" ? error : "No onboarding driver with this id exists for this company."}</p>
        <Button className="mt-4" variant="outline" onClick={back}>Back to Drivers</Button>
      </div>
    )
  }

  const name = [prospect.givenName, prospect.familyName].filter(Boolean).join(" ") || "Unnamed driver"
  const progress = prospect.onboarding
  const statusText = progress.onboarding ? `Onboarding · ${progress.currentLabel}` : prospect.statusLabel
  const s = prospect.status

  return (
    <div className="flex flex-col gap-6 pb-10">
      {company ? (
        <CompanyWorkspaceHeader
          company={company}
          section="Drivers"
          description="Driver record"
          actions={<Button variant="outline" onClick={back}><ArrowLeft className="mr-2 size-4" />Back to Drivers</Button>}
        />
      ) : null}
      {message ? <p role="status" className={`text-sm ${message.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p> : null}

      <div className="space-y-6">
        {/* Same executive header card as the other driver records; the chronology uses the free right-hand space (beneath the name and status on a phone). */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
          <div className={`grid gap-5 ${progress.onboarding ? "lg:grid-cols-[minmax(0,1fr)_260px]" : ""}`}>
            <div className="flex items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-lg font-bold text-primary" aria-hidden>
                {(prospect.givenName?.[0] ?? "") + (prospect.familyName?.[0] ?? "")}
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl" data-testid="driver-name">{name}</h1>
                  <span data-testid="driver-status" className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                    <span className="size-1.5 rounded-full bg-current" />
                    {statusText}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{[prospect.email, prospect.phone].filter(Boolean).join(" · ") || "No contact on record"}</p>
                <p className="text-xs text-muted-foreground">Not an active company driver{progress.onboarding ? " — activation follows onboarding." : "."}</p>
              </div>
            </div>
            {progress.onboarding ? (
              <div className="rounded-xl border bg-muted/20 p-4" data-testid="hiring-chronology-card">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Hiring chronology</p>
                <OnboardingChronology progress={progress} />
              </div>
            ) : null}
          </div>
        </div>

        <Card data-testid="operating-scope-card">
          <CardHeader className="border-b bg-muted/30 py-3"><CardTitle className="text-sm">Operating scope</CardTitle></CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            {scopeForm ? (
              <>
                <OperatingScopeFields value={scopeForm} onChange={setScopeForm} presentation={presentation?.country ?? null} idPrefix="detail-scope" />
                {s === "INVITED" ? <p className="text-xs text-amber-700">Changing the scope cancels the application already sent. Send a new application afterwards.</p> : null}
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy || previewScope(scopeForm).errors.length > 0} onClick={() => run(() => api.setOperatingScope(companyId, prospectId, toScopeInput(scopeForm)), "Operating scope saved.")}>Save operating scope</Button>
                  <Button size="sm" variant="ghost" onClick={() => setScopeForm(null)}>Cancel</Button>
                </div>
              </>
            ) : (
              <>
                {prospect.operatingScope ? (
                  <div data-testid="scope-summary">
                    <p className="font-medium">{SCOPE_LABEL[prospect.operatingScope.kind]}</p>
                    <p className="text-xs text-muted-foreground">{[...prospect.operatingScope.usJurisdictions, ...prospect.operatingScope.caJurisdictions].join(", ") || "No jurisdictions listed"}</p>
                  </div>
                ) : (
                  <p data-testid="scope-summary" className="text-muted-foreground">Not yet determined. An application cannot be sent until the driver&apos;s operating scope is established.</p>
                )}
                {prospect.scopeEvaluation.issuable ? (
                  <p className="text-xs text-muted-foreground">Application: {prospect.scopeEvaluation.profile.applicationRegion} · {prospect.scopeEvaluation.profile.employmentHistoryYears}-year history{prospect.scopeEvaluation.profile.sections.clearinghouse ? " · Clearinghouse consent" : ""}{prospect.scopeEvaluation.profile.sections.psp ? " · PSP authorization" : ""}</p>
                ) : null}
                {prospect.scopeEvaluation.issuable && prospect.scopeEvaluation.profile.manualVerification.length ? (
                  <p className="text-xs text-muted-foreground">Verify outside the application: {prospect.scopeEvaluation.profile.manualVerification.join(" ")}</p>
                ) : null}
                <p className="text-[11px] text-muted-foreground">Selecting a scope does not establish that the driver is qualified or eligible.</p>
                {(s === "PROSPECT" || s === "INVITED") && prospect.scopeAvailable ? <Button size="sm" variant="outline" onClick={() => setScopeForm(scopeFormFrom(prospect.operatingScope))}>{prospect.operatingScope ? "Change operating scope" : "Set operating scope"}</Button> : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-muted/30 py-3"><CardTitle className="text-sm">Application</CardTitle></CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {s === "PROSPECT" || s === "INVITED" ? (
                prospect.canInvite ? (
                  <Button size="sm" disabled={busy} onClick={() => run(() => api.sendApplication(companyId, prospectId), "Application sent.")}>
                    <Send className="mr-2 size-4" />{s === "INVITED" ? "Resend application" : "Send application"}
                  </Button>
                ) : (
                  <Button size="sm" disabled title={prospect.inviteBlockedReason ?? undefined}><Send className="mr-2 size-4" />Send application</Button>
                )
              ) : null}
              {s === "APPLICATION_SUBMITTED" || s === "UNDER_REVIEW" || s === "APPROVED" ? <Button size="sm" variant="outline" onClick={() => openApplication("view")}>View application</Button> : null}
              {s === "APPLICATION_SUBMITTED" ? <Button size="sm" disabled={busy} onClick={() => run(() => api.reviewOnboardingDriver(companyId, prospectId, "UNDER_REVIEW"), "Verification started.")}>Start verification</Button> : null}
              {s === "UNDER_REVIEW" ? (
                <>
                  <Button size="sm" disabled={busy} onClick={() => run(() => api.reviewOnboardingDriver(companyId, prospectId, "APPROVED"), "Approved. Start onboarding to continue.")}>Approve</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => api.reviewOnboardingDriver(companyId, prospectId, "REJECTED"), "Rejected.")}>Reject</Button>
                </>
              ) : null}
              {s === "APPROVED" && !prospect.convertedRelationshipId ? <Button size="sm" onClick={() => openApplication("onboard")}>Start hiring package</Button> : null}
              {s === "APPROVED" && prospect.convertedRelationshipId ? <span className="text-xs text-muted-foreground">Hiring package started — not active yet</span> : null}
            </div>
            {!prospect.canInvite && (s === "PROSPECT" || s === "INVITED") ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{prospect.inviteBlockedReason}</p>
                {!prospect.email ? (
                  <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); void run(() => api.addOnboardingEmail(companyId, prospectId, email), "Email address added.") }}>
                    <div className="space-y-1"><Label htmlFor="add-email">Email address</Label><Input id="add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                    <Button type="submit" size="sm" variant="outline" disabled={busy || !email.trim()}>Add email</Button>
                  </form>
                ) : null}
              </div>
            ) : null}
            {prospect.invitation?.deliveryFailed ? <p className="text-xs text-red-600">The last email could not be delivered. You can send it again.</p> : null}

            {application ? (
              <div className="rounded-lg border p-4 text-xs" data-testid="application-view">
                <p className="font-semibold">Submitted application</p>
                <p className="text-muted-foreground">Receipt {application.receiptId} · {application.submittedAt.slice(0, 10)}</p>
                <p className="mt-2">Steps completed: {(application.payload?.completedSteps ?? []).join(", ") || "none recorded"}</p>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setApplication(null)}>Close</Button>
              </div>
            ) : null}

            {onboarding ? (
              <form
                className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"
                data-testid="onboard-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(
                    () => api.convertOnboardingDriver(companyId, prospectId, { relationshipType: onboarding.relationshipType, relationshipStartDate: onboarding.relationshipStartDate, dateOfBirth: onboarding.dateOfBirth, driverNumber: onboarding.driverNumber, licence: { country: onboarding.licenceCountry, region: onboarding.licenceRegion, number: onboarding.licenceNumber, effectiveFrom: onboarding.licenceEffectiveFrom } }),
                    "Hiring package started. The driver is not active until onboarding is completed.",
                  )
                }}
              >
                <p className="text-sm font-semibold sm:col-span-2">Start hiring package — full company-driver requirements apply</p>
                <div className="space-y-1"><Label htmlFor="ob-type">Relationship</Label><select id="ob-type" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={onboarding.relationshipType} onChange={(e) => setOnboarding({ ...onboarding, relationshipType: e.target.value })}><option value="EMPLOYEE">Employee</option><option value="CONTRACTOR">Contractor</option><option value="OWNER_OPERATOR">Owner-operator</option></select></div>
                <div className="space-y-1"><Label htmlFor="ob-start">Relationship start date *</Label><Input id="ob-start" type="date" required value={onboarding.relationshipStartDate} onChange={(e) => setOnboarding({ ...onboarding, relationshipStartDate: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="ob-dob">Date of birth *</Label><Input id="ob-dob" type="date" required value={onboarding.dateOfBirth} onChange={(e) => setOnboarding({ ...onboarding, dateOfBirth: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="ob-num">Driver number</Label><Input id="ob-num" value={onboarding.driverNumber} onChange={(e) => setOnboarding({ ...onboarding, driverNumber: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="ob-lic">Licence number *</Label><Input id="ob-lic" required value={onboarding.licenceNumber} onChange={(e) => setOnboarding({ ...onboarding, licenceNumber: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="ob-lic-from">Licence effective from *</Label><Input id="ob-lic-from" type="date" required value={onboarding.licenceEffectiveFrom} onChange={(e) => setOnboarding({ ...onboarding, licenceEffectiveFrom: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="ob-country">Licence country *</Label><select id="ob-country" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={onboarding.licenceCountry} onChange={(e) => setOnboarding({ ...onboarding, licenceCountry: e.target.value })}><option value="CA">Canada</option><option value="US">United States</option></select></div>
                <div className="space-y-1"><Label htmlFor="ob-region">Licence province / state code *</Label><Input id="ob-region" required maxLength={3} value={onboarding.licenceRegion} onChange={(e) => setOnboarding({ ...onboarding, licenceRegion: e.target.value.toUpperCase() })} placeholder="ON" /></div>
                <div className="flex gap-2 sm:col-span-2"><Button type="submit" size="sm" disabled={busy}>Start hiring package</Button><Button type="button" size="sm" variant="ghost" onClick={() => setOnboarding(null)}>Cancel</Button></div>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
