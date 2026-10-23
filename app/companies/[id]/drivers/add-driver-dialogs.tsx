"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import * as api from "./prospect-api"
import type { PresentationContext, PresentationCountry } from "@/lib/jurisdiction-context"
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
            <div className="mt-1 text-sm text-muted-foreground">Name plus an email or phone is enough. The driver shows as Onboarding and can be sent an application.</div>
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
  const [context, setContext] = useState<PresentationContext | null>(null)
  const [choice, setChoice] = useState<PresentationCountry | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const noContact = !form.email.trim() && !form.phone.trim()
  const preview = previewScope(scope)
  const scopeIssuable = Boolean(preview.evaluation?.issuable)
  const canSend = Boolean(form.email.trim()) && scopeIssuable
  // The company's primary jurisdiction only decides what is listed first. If it cannot be established, an explicit choice is required (never assumed).
  const needsChoice = context?.basis === "UNRESOLVED" && !choice
  const presentation: PresentationCountry | null = context?.country ?? choice

  useEffect(() => {
    let live = true
    api.getOnboardingContext(companyId).then((c) => live && setContext(c)).catch(() => live && setContext({ country: null, basis: "UNRESOLVED", reason: "The company's primary jurisdiction could not be loaded." }))
    return () => { live = false }
  }, [companyId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (context?.basis === "UNRESOLVED" && choice) await api.setPresentationCountry(companyId, choice)
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
          <p className="text-xs text-muted-foreground sm:col-span-2">Enter an email or a phone number. An application can be emailed only when there is an email address.</p>
          {context?.basis === "UNRESOLVED" ? (
            <fieldset className="space-y-1 rounded-md border p-3 sm:col-span-2" data-testid="presentation-choice">
              <legend className="px-1 text-sm font-medium">Company&apos;s primary jurisdiction *</legend>
              <p className="text-xs text-muted-foreground">{context.reason} Choose which country TES should list first for this company. This sets display order only; it does not decide what this driver&apos;s application requires.</p>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5"><input type="radio" name="presentation" checked={choice === "US"} onChange={() => setChoice("US")} />United States</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="presentation" checked={choice === "CA"} onChange={() => setChoice("CA")} />Canada</label>
              </div>
            </fieldset>
          ) : null}
          <div className="sm:col-span-2">
            <OperatingScopeFields value={scope} onChange={setScope} presentation={presentation} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.sendNow} disabled={!canSend} onChange={(e) => setForm({ ...form, sendNow: e.target.checked })} />
            Send the application now{!scopeIssuable ? " (available once the operating scope is established)" : ""}
          </label>
          {error ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !form.first.trim() || !form.last.trim() || noContact || needsChoice || preview.errors.length > 0 || context === null}>{saving ? "Saving…" : "Save driver"}</Button>
        </div>
      </form>
    </div>
  )
}
