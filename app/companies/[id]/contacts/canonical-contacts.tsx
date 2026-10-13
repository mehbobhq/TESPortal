"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Channel = { id: string; channelType: "EMAIL" | "PHONE"; usage: string | null; valueDisplay: string; effectiveFrom: string }
type Contact = {
  relationship: { id: string; effectiveTo: string | null }
  person: { id: string }
  current: {
    name: { givenName: string | null; familyName: string | null } | null
    channels: Channel[]
    titles: { titleDisplay: string }[]
    purposes: { purpose: string; isPrimary: boolean }[]
  }
}
type View = { currentChannels: Channel[]; contacts: Contact[] }

const USAGES = ["GENERAL", "DISPATCH", "OFFICE", "ACCOUNTING", "SAFETY"]
const PURPOSES = ["PRIMARY", "BILLING", "SAFETY", "OPERATIONS", "COMPLIANCE", "EMERGENCY"]

/**
 * Contacts for one company, from the canonical contacts domain (PostgreSQL). A person is a contact of this company through a
 * relationship; the company's own phone/email lines are organization channels with a usage. Nothing is deleted: an ended line
 * or contact stays in history.
 */
export function CanonicalContacts({ companyId }: { companyId: string }) {
  const base = `/api/companies/${encodeURIComponent(companyId)}/contacts`
  const [view, setView] = useState<View | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(base, { cache: "no-store" })
      if (response.status === 403) return setState("denied")
      if (!response.ok) return setState("error")
      setView(await response.json())
      setState("ready")
    } catch {
      setState("error")
    }
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  async function act(payload: Record<string, unknown>, done: string) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      if (!response.ok) {
        setMessage((await response.json().catch(() => null))?.error ?? "The change could not be saved.")
        return
      }
      setMessage(done)
      await load()
    } catch {
      setMessage("The change could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  if (state === "loading") return <div className="p-10 text-center text-sm">Loading contacts...</div>
  if (state === "denied") return <div className="p-10 text-center text-sm">You are not permitted to view this company's contacts.</div>
  if (state === "error" || !view) return <div className="p-10 text-center text-sm">Contacts could not be loaded. This is a temporary error, not an empty list.</div>

  const active = view.contacts.filter((contact) => contact.relationship.effectiveTo === null)

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl">
      <h1 className="text-xl font-semibold">Contacts</h1>
      {message ? <p role="status" className="text-sm">{message}</p> : null}

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle className="text-sm">Company phone and email lines</CardTitle></CardHeader>
        <CardContent className="pt-4 space-y-3">
          {view.currentChannels.length === 0 ? <p className="text-sm text-muted-foreground">No company phone or email has been recorded.</p> : null}
          {view.currentChannels.map((channel) => (
            <div key={channel.id} className="flex items-center justify-between text-sm">
              <span>{channel.channelType === "PHONE" ? "Phone" : "Email"} · {channel.usage ?? "—"} · {channel.valueDisplay}</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "endChannel", channelId: channel.id }, "Line ended (kept in history).")}>End</Button>
            </div>
          ))}
          <form
            className="grid sm:grid-cols-4 gap-3 pt-2"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              const type = String(form.get("type"))
              void act({ action: "addChannel", channel: { type, value: String(form.get("value") ?? ""), usage: String(form.get("usage")) } }, "Line added.")
              event.currentTarget.reset()
            }}
          >
            <select name="type" className="h-9 rounded-md border bg-background px-3 text-sm" aria-label="Line type"><option value="PHONE">Phone</option><option value="EMAIL">Email</option></select>
            <select name="usage" className="h-9 rounded-md border bg-background px-3 text-sm" aria-label="Usage">{USAGES.map((usage) => <option key={usage}>{usage}</option>)}</select>
            <Input name="value" placeholder="Number or address" required />
            <Button type="submit" disabled={busy}>Add line</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle className="text-sm">People ({active.length})</CardTitle></CardHeader>
        <CardContent className="pt-4 space-y-4">
          {active.length === 0 ? <p className="text-sm text-muted-foreground">No contacts have been recorded for this company.</p> : null}
          {active.map((contact) => (
            <div key={contact.relationship.id} className="border rounded-md p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <strong>{[contact.current.name?.givenName, contact.current.name?.familyName].filter(Boolean).join(" ") || "Unnamed contact"}</strong>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "endRelationship", relationshipId: contact.relationship.id }, "Contact ended (kept in history).")}>End contact</Button>
              </div>
              {contact.current.titles.map((title) => <div key={title.titleDisplay}>{title.titleDisplay}</div>)}
              <div className="text-muted-foreground">{contact.current.purposes.map((p) => (p.isPrimary ? `${p.purpose} (primary)` : p.purpose)).join(", ") || "No purpose recorded"}</div>
              {contact.current.channels.map((channel) => <div key={channel.id}>{channel.channelType === "PHONE" ? "Phone" : "Email"}: {channel.valueDisplay}</div>)}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle className="text-sm">Add a contact</CardTitle></CardHeader>
        <CardContent className="pt-4">
          <form
            className="grid sm:grid-cols-3 gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              const field = (name: string) => String(form.get(name) ?? "").trim()
              const channels = [
                field("phone") ? { type: "PHONE", value: field("phone") } : null,
                field("email") ? { type: "EMAIL", value: field("email") } : null,
              ].filter(Boolean)
              const purpose = field("purpose")
              void act(
                {
                  action: "createContact",
                  name: { givenName: field("givenName"), familyName: field("familyName") },
                  titles: field("title") ? [field("title")] : [],
                  purposes: purpose ? [{ purpose, primary: purpose === "PRIMARY" }] : [],
                  channels,
                },
                "Contact added.",
              )
              event.currentTarget.reset()
            }}
          >
            <div className="space-y-1"><Label htmlFor="givenName">Given name</Label><Input id="givenName" name="givenName" /></div>
            <div className="space-y-1"><Label htmlFor="familyName">Family name</Label><Input id="familyName" name="familyName" /></div>
            <div className="space-y-1"><Label htmlFor="title">Title</Label><Input id="title" name="title" /></div>
            <div className="space-y-1"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" /></div>
            <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" /></div>
            <div className="space-y-1">
              <Label htmlFor="purpose">Purpose</Label>
              <select id="purpose" name="purpose" className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="">None</option>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select>
            </div>
            <div className="sm:col-span-3"><Button type="submit" disabled={busy}>Add contact</Button></div>
          </form>
          <p className="text-xs text-muted-foreground mt-3">Contacts saved only in a browser by the earlier prototype are not shown here. They were not deleted.</p>
        </CardContent>
      </Card>
    </div>
  )
}
