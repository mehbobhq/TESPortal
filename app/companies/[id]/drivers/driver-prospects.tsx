"use client"

import { useCallback, useEffect, useState } from "react"
import { Send, UserPlus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ProspectView } from "@/lib/driver-prospects/types"

const LIFECYCLE = ["Prospect", "Invitation Sent", "Application Submitted", "Under Review", "Approved"]

/**
 * Prospects live in PostgreSQL (not in this browser). A prospect is NOT a company driver: it needs only a name and a way to reach the person,
 * and it never appears in the driver roster below until it is approved and onboarded with the full requirements ("Add Company Driver").
 */
export function DriverProspects({ companyId }: { companyId: string }) {
  const base = `/api/companies/${encodeURIComponent(companyId)}/driver-prospects`
  const [prospects, setProspects] = useState<ProspectView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ fullName: "", email: "", phone: "" })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [panel, setPanel] = useState<{ prospectId: string; kind: "application" | "onboard"; submission: { receiptId: string; submittedAt: string; payload: any } | null } | null>(null)
  const [onboard, setOnboard] = useState({ relationshipType: "EMPLOYEE", relationshipStartDate: "", dateOfBirth: "", licenceCountry: "CA", licenceRegion: "", licenceNumber: "", licenceEffectiveFrom: "", driverNumber: "" })

  const load = useCallback(async () => {
    try {
      const response = await fetch(base, { cache: "no-store" })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? "Unable to load driver prospects.")
      setProspects(body.prospects ?? [])
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load driver prospects.")
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? "Unable to save the driver prospect.")
      setForm({ fullName: "", email: "", phone: "" })
      setOpen(false)
      setMessage({ tone: "ok", text: "Prospect saved. It is not a company driver yet." })
      await load()
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to save the driver prospect." })
    } finally {
      setSaving(false)
    }
  }

  async function send(prospect: ProspectView) {
    setSendingId(prospect.prospectId)
    setMessage(null)
    try {
      const response = await fetch(`${base}/${encodeURIComponent(prospect.prospectId)}/invitation`, { method: "POST" })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? "Unable to send the application.")
      setMessage({ tone: "ok", text: "Application sent." })
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to send the application." })
    } finally {
      setSendingId(null)
      await load()
    }
  }

  async function act(prospect: ProspectView, path: string, body: unknown, okText: string) {
    setBusyId(prospect.prospectId)
    setMessage(null)
    try {
      const response = await fetch(`${base}/${encodeURIComponent(prospect.prospectId)}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const result = await response.json().catch(() => null)
      if (!response.ok) throw new Error(result?.error ?? "The action could not be completed.")
      setMessage({ tone: "ok", text: okText })
      setPanel(null)
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The action could not be completed." })
    } finally {
      setBusyId(null)
      await load()
    }
  }

  async function openApplication(prospect: ProspectView, kind: "application" | "onboard") {
    setMessage(null)
    try {
      const response = await fetch(`${base}/${encodeURIComponent(prospect.prospectId)}/submission`, { cache: "no-store" })
      const result = await response.json().catch(() => null)
      if (!response.ok) throw new Error(result?.error ?? "Unable to load the application.")
      if (kind === "onboard") {
        const draft = result.payload?.draft ?? {}
        const lic = draft.drivingLicence ?? {}
        const region = typeof lic.jurisdiction === "string" && lic.jurisdiction.trim().length === 2 ? lic.jurisdiction.trim().toUpperCase() : ""
        setOnboard((o) => ({
          ...o,
          dateOfBirth: draft.aboutYou?.dateOfBirth ?? "",
          licenceNumber: lic.licenceNumber ?? "",
          licenceRegion: region,
          licenceCountry: lic.country === "United States" ? "US" : "CA",
          licenceEffectiveFrom: lic.issueDate ?? "",
        }))
      }
      setPanel({ prospectId: prospect.prospectId, kind, submission: result })
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to load the application." })
    }
  }

  const needsContact = !form.email.trim() && !form.phone.trim()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b bg-muted/30 py-3">
        <div>
          <CardTitle className="text-sm">Driver prospects</CardTitle>
          <p className="text-[11px] text-muted-foreground">People you are recruiting. Not company drivers until approved and onboarded.</p>
        </div>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          <UserPlus className="mr-2 size-4" />
          Add Prospect / Send Application
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {message ? <p role="status" className={`text-sm ${message.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p> : null}
        {open ? (
          <form onSubmit={save} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor="prospect-name">Full name *</Label>
              <Input id="prospect-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoComplete="off" required />
            </div>
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor="prospect-email">Email</Label>
              <Input id="prospect-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" />
            </div>
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor="prospect-phone">Phone</Label>
              <Input id="prospect-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="off" />
            </div>
            <p className="text-[11px] text-muted-foreground sm:col-span-3">
              Enter an email or a phone number. Date of birth, address and licence are collected later, when the person is onboarded as a company driver. An email is needed to send the application.
            </p>
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" size="sm" disabled={saving || !form.fullName.trim() || needsContact}>{saving ? "Saving…" : "Save prospect"}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setForm({ fullName: "", email: "", phone: "" }) }}>Cancel</Button>
            </div>
          </form>
        ) : null}
        {loading ? <p className="text-xs text-muted-foreground">Loading prospects…</p> : null}
        {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
        {!loading && !loadError && prospects.length === 0 ? <p className="py-3 text-center text-xs text-muted-foreground">No prospects yet.</p> : null}
        <div className="divide-y">
          {prospects.map((p) => (
            <div key={p.prospectId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{[p.givenName, p.familyName].filter(Boolean).join(" ") || "Unnamed prospect"}</p>
                <p className="truncate text-[11px] text-muted-foreground">{[p.email, p.phone].filter(Boolean).join(" · ") || "No contact on record"}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {LIFECYCLE.includes(p.statusLabel) ? LIFECYCLE.map((s) => (s === p.statusLabel ? `[${s}]` : s)).join(" › ") : p.statusLabel}
                  {p.invitation?.deliveryFailed ? " · last email could not be delivered" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{p.statusLabel}</Badge>
                {p.status === "APPLICATION_SUBMITTED" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => openApplication(p, "application")}>View application</Button>
                    <Button size="sm" disabled={busyId === p.prospectId} onClick={() => act(p, "review", { to: "UNDER_REVIEW" }, "Review started.")}>Start review</Button>
                  </>
                ) : null}
                {p.status === "UNDER_REVIEW" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => openApplication(p, "application")}>View application</Button>
                    <Button size="sm" disabled={busyId === p.prospectId} onClick={() => act(p, "review", { to: "APPROVED" }, "Prospect approved. Onboard them as a company driver to continue.")}>Approve</Button>
                    <Button size="sm" variant="outline" disabled={busyId === p.prospectId} onClick={() => act(p, "review", { to: "REJECTED" }, "Prospect rejected.")}>Reject</Button>
                  </>
                ) : null}
                {p.status === "APPROVED" && !p.convertedRelationshipId ? (
                  <Button size="sm" onClick={() => openApplication(p, "onboard")}>Onboard as company driver</Button>
                ) : null}
                {p.status === "APPROVED" && p.convertedRelationshipId ? <span className="text-[11px] text-muted-foreground">Onboarding started — not active yet</span> : null}
                {p.status === "PROSPECT" || p.status === "INVITED" ? (
                  <Button size="sm" variant="outline" disabled={!p.canInvite || sendingId === p.prospectId} title={p.inviteBlockedReason ?? undefined} onClick={() => send(p)}>
                    <Send className="mr-2 size-4" />
                    {sendingId === p.prospectId ? "Sending…" : p.status === "INVITED" ? "Resend" : "Send application"}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {panel && panel.kind === "application" ? (
          <div className="rounded-lg border p-4 text-xs" data-testid="application-view">
            <p className="font-semibold">Submitted application</p>
            <p className="text-muted-foreground">Receipt {panel.submission?.receiptId} · {panel.submission?.submittedAt?.slice(0, 10)}</p>
            <p className="mt-2">Steps completed: {(panel.submission?.payload?.completedSteps ?? []).join(", ") || "none recorded"}</p>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setPanel(null)}>Close</Button>
          </div>
        ) : null}
        {panel && panel.kind === "onboard" ? (
          <form
            className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"
            data-testid="onboard-form"
            onSubmit={(e) => {
              e.preventDefault()
              const target = prospects.find((x) => x.prospectId === panel.prospectId)
              if (target) void act(target, "convert", { relationshipType: onboard.relationshipType, relationshipStartDate: onboard.relationshipStartDate, dateOfBirth: onboard.dateOfBirth, driverNumber: onboard.driverNumber, licence: { country: onboard.licenceCountry, region: onboard.licenceRegion, number: onboard.licenceNumber, effectiveFrom: onboard.licenceEffectiveFrom } }, "Onboarding started. The driver is not active until onboarding is completed.")
            }}
          >
            <p className="text-sm font-semibold sm:col-span-2">Onboard as company driver — full requirements apply</p>
            <div className="space-y-1"><Label htmlFor="ob-type">Relationship</Label><select id="ob-type" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={onboard.relationshipType} onChange={(e) => setOnboard({ ...onboard, relationshipType: e.target.value })}><option value="EMPLOYEE">Employee</option><option value="CONTRACTOR">Contractor</option><option value="OWNER_OPERATOR">Owner-operator</option></select></div>
            <div className="space-y-1"><Label htmlFor="ob-start">Relationship start date *</Label><Input id="ob-start" type="date" required value={onboard.relationshipStartDate} onChange={(e) => setOnboard({ ...onboard, relationshipStartDate: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="ob-dob">Date of birth *</Label><Input id="ob-dob" type="date" required value={onboard.dateOfBirth} onChange={(e) => setOnboard({ ...onboard, dateOfBirth: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="ob-num">Driver number</Label><Input id="ob-num" value={onboard.driverNumber} onChange={(e) => setOnboard({ ...onboard, driverNumber: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="ob-lic">Licence number *</Label><Input id="ob-lic" required value={onboard.licenceNumber} onChange={(e) => setOnboard({ ...onboard, licenceNumber: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="ob-lic-from">Licence effective from *</Label><Input id="ob-lic-from" type="date" required value={onboard.licenceEffectiveFrom} onChange={(e) => setOnboard({ ...onboard, licenceEffectiveFrom: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="ob-country">Licence country *</Label><select id="ob-country" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={onboard.licenceCountry} onChange={(e) => setOnboard({ ...onboard, licenceCountry: e.target.value })}><option value="CA">Canada</option><option value="US">United States</option></select></div>
            <div className="space-y-1"><Label htmlFor="ob-region">Licence province / state code *</Label><Input id="ob-region" required maxLength={3} value={onboard.licenceRegion} onChange={(e) => setOnboard({ ...onboard, licenceRegion: e.target.value.toUpperCase() })} placeholder="ON" /></div>
            <div className="flex gap-2 sm:col-span-2"><Button type="submit" size="sm" disabled={busyId === panel.prospectId}>Start onboarding</Button><Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>Cancel</Button></div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}
