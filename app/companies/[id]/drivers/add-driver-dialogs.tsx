"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import * as api from "./prospect-api"
import type { CompanyOperatingFacts } from "@/lib/driver-prospects/company-operating-facts"
import { emptyScopeForm, OperatingScopeFields, previewScope, toScopeInput, type ScopeFormState } from "./operating-scope-fields"

const overlay = "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 md:p-8"

/** The single Add Driver entry point: choose how the driver joins. The established-driver path is the unchanged existing form. */
export function AddDriverChooser({ onOnboarding, onEstablished, onClose }: { onOnboarding: () => void; onEstablished: () => void; onClose: () => void }) {
  return (
    <div className={overlay} role="dialog" aria-label="Add Driver">
      <div className="w-full max-w-lg rounded-xl bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b p-5">
          <div><h2 className="text-xl font-semibold">Add Driver</h2><p className="text-sm text-muted-foreground">How is this driver joining?</p></div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="size-4" /></Button>
        </div>
        <div className="grid gap-3 p-5">
          <button type="button" onClick={onOnboarding} className="rounded-lg border p-4 text-left hover:bg-muted/40" data-testid="choose-onboarding">
            <div className="font-semibold">New hire — start onboarding</div>
            <div className="mt-1 text-sm text-muted-foreground">A name is enough to save. The driver shows as Onboarding and can be sent an application.</div>
          </button>
          <button type="button" onClick={onEstablished} className="rounded-lg border p-4 text-left hover:bg-muted/40" data-testid="choose-established">
            <div className="font-semibold">Established driver</div>
            <div className="mt-1 text-sm text-muted-foreground">Full driver record with licence, address and dates, as before.</div>
          </button>
        </div>
      </div>
    </div>
  )
}

export function OnboardingDriverDialog({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ first: "", last: "", email: "", phone: "", sendNow: false })
  const [scope, setScope] = useState<ScopeFormState>(emptyScopeForm())
  const [facts, setFacts] = useState<CompanyOperatingFacts | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = previewScope(scope, facts)
  const scopeIssuable = Boolean(preview.evaluation?.issuable)
  // Email and phone are optional for saving. An application is emailed, so sending needs an email address (SMS delivery is not available).
  const canSend = Boolean(form.email.trim()) && scopeIssuable
  const noContact = !form.email.trim() && !form.phone.trim()

  useEffect(() => {
    let live = true
    api.getCompanyOperatingFacts(companyId).then((f) => live && setFacts(f)).catch(() => live && setFacts(null))
    return () => { live = false }
  }, [companyId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const created = await api.createOnboardingDriver(companyId, {
        fullName: `${form.first.trim()} ${form.last.trim()}`.trim(),
        email: form.email,
        phone: form.phone,
        scope: scope.kind === "UNDETERMINED" ? undefined : toScopeInput(scope),
      })
      if (form.sendNow && canSend) {
        try {
          await api.sendApplication(companyId, created.prospectId)
        } catch (sendError) {
          onCreated()
          setError(`The driver was saved, but the application was not sent: ${sendError instanceof Error ? sendError.message : "delivery failed"}. Open the driver to try again.`)
          setSaving(false)
          return
        }
      }
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the driver.")
      setSaving(false)
    }
  }

  return (
    <div className={overlay} role="dialog" aria-label="Add onboarding driver">
      <form onSubmit={submit} className="w-full max-w-lg rounded-xl bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b p-5">
          <div><h2 className="text-xl font-semibold">Add Driver — start onboarding</h2><p className="text-sm text-muted-foreground">Date of birth, address, licence and dates are collected later.</p></div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="size-4" /></Button>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="nh-first">First name *</Label><Input id="nh-first" value={form.first} onChange={(e) => setForm({ ...form, first: e.target.value })} required autoComplete="off" /></div>
          <div className="space-y-1.5"><Label htmlFor="nh-last">Last name *</Label><Input id="nh-last" value={form.last} onChange={(e) => setForm({ ...form, last: e.target.value })} required autoComplete="off" /></div>
          <div className="space-y-1.5"><Label htmlFor="nh-email">Email</Label><Input id="nh-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value, sendNow: e.target.value.trim() ? form.sendNow : false })} autoComplete="off" /></div>
          <div className="space-y-1.5"><Label htmlFor="nh-phone">Phone</Label><Input id="nh-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="off" /></div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Email and phone are optional for saving. An application can be sent only when the driver has an email address{noContact ? " — add contact information before sending one" : ""}.</p>
          <div className="sm:col-span-2">
            <OperatingScopeFields value={scope} onChange={setScope} facts={facts} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.sendNow} disabled={!canSend} onChange={(e) => setForm({ ...form, sendNow: e.target.checked })} />
            Send the application now{!form.email.trim() ? " (requires an email address)" : !scopeIssuable ? " (available once the intended operation is chosen)" : ""}
          </label>
          {error ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !form.first.trim() || !form.last.trim() || preview.errors.length > 0}>{saving ? "Saving…" : "Save driver"}</Button>
        </div>
      </form>
    </div>
  )
}
