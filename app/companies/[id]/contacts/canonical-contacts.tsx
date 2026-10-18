"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Channel = { id: string; channelType: "EMAIL" | "PHONE" | "WEBSITE"; usage: string | null; valueDisplay: string; effectiveFrom: string }
type Contact = {
  relationship: { id: string; effectiveTo: string | null }
  person: { id: string; recordStatus?: string }
  current: {
    name: { givenName: string | null; familyName: string | null } | null
    channels: Channel[]
    titles: { id: string; titleDisplay: string }[]
    purposes: { id: string; purpose: string; isPrimary: boolean }[]
  }
}
type Match = { personId: string; displayName: string; reasons: string[] }
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
  const [matches, setMatches] = useState<Match[]>([])
  const [query, setQuery] = useState("")
  const [purposeFilter, setPurposeFilter] = useState("ALL")
  const [showArchived, setShowArchived] = useState(false)

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
    setMatches([])
    try {
      const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage(body?.error ?? "The change could not be saved.")
        return
      }
      setMessage(done)
      if (payload.action === "createContact" && Array.isArray(body?.matches)) setMatches(body.matches)
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

  const archivedOf = (contact: Contact) => contact.person.recordStatus === "archived"
  const active = view.contacts.filter((contact) => contact.relationship.effectiveTo === null)
  // An ended contact stays in history; its person may then be archived (the domain requires the relationship to end first) and restored.
  const archived = view.contacts.filter((contact) => contact.relationship.effectiveTo !== null)
  const nameOf = (contact: Contact) => [contact.current.name?.givenName, contact.current.name?.familyName].filter(Boolean).join(" ") || "Unnamed contact"
  const matchesQuery = (contact: Contact) => {
    const text = `${nameOf(contact)} ${contact.current.titles.map((t) => t.titleDisplay).join(" ")} ${contact.current.channels.map((c) => c.valueDisplay).join(" ")}`.toLowerCase()
    return (!query.trim() || text.includes(query.trim().toLowerCase())) && (purposeFilter === "ALL" || contact.current.purposes.some((p) => p.purpose === purposeFilter))
  }
  const shown = (showArchived ? [...active, ...archived] : active).filter(matchesQuery)
  const withPrimary = active.filter((contact) => contact.current.purposes.some((p) => p.isPrimary && p.purpose === "PRIMARY")).length

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl">
      <h1 className="text-xl font-semibold">Contacts</h1>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
      {matches.length > 0 ? (
        <div role="note" className="rounded-md border border-amber-500/40 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
          <p className="font-semibold">Possible existing people (review only; nothing was merged)</p>
          <ul className="list-disc pl-5">{matches.map((m) => <li key={m.personId}>{m.displayName} — matched on {m.reasons.join(", ").toLowerCase()}</li>)}</ul>
        </div>
      ) : null}

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle className="text-sm">Company phone and email lines</CardTitle></CardHeader>
        <CardContent className="pt-4 space-y-3">
          {view.currentChannels.length === 0 ? <p className="text-sm text-muted-foreground">No company phone or email has been recorded.</p> : null}
          {view.currentChannels.map((channel) => (
            <div key={channel.id} className="flex items-center justify-between text-sm">
              <span>{channel.channelType === "PHONE" ? "Phone" : channel.channelType === "WEBSITE" ? "Website" : "Email"} · {channel.usage ?? "—"} · {channel.valueDisplay}</span>
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

      <div className="grid grid-cols-3 gap-3 text-sm" aria-label="Contact summary">
        <div className="rounded-md border p-3"><p className="text-[11px] uppercase text-muted-foreground">Contacts</p><p className="text-lg font-semibold">{active.length}</p></div>
        <div className="rounded-md border p-3"><p className="text-[11px] uppercase text-muted-foreground">With a primary purpose</p><p className="text-lg font-semibold">{withPrimary}</p></div>
        <div className="rounded-md border p-3"><p className="text-[11px] uppercase text-muted-foreground">Company lines</p><p className="text-lg font-semibold">{view.currentChannels.length}</p></div>
      </div>

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle className="text-sm">People ({shown.length})</CardTitle></CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Search contacts" placeholder="Search name, title, phone, email…" value={query} onChange={(event) => setQuery(event.target.value)} className="max-w-xs" />
            <select aria-label="Purpose filter" className="h-9 rounded-md border bg-background px-3 text-sm" value={purposeFilter} onChange={(event) => setPurposeFilter(event.target.value)}>
              <option value="ALL">All purposes</option>
              {PURPOSES.map((p) => <option key={p}>{p}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Include ended contacts ({archived.length})</label>
          </div>
          {shown.length === 0 ? <p className="text-sm text-muted-foreground">{active.length === 0 && archived.length === 0 ? "No contacts have been recorded for this company." : "No contacts match."}</p> : null}
          {shown.map((contact) => (
            <div key={contact.relationship.id} className="border rounded-md p-3 text-sm space-y-2">
              <div className="flex items-center justify-between">
                <strong>{nameOf(contact)}{contact.relationship.effectiveTo !== null ? " (ended)" : ""}{archivedOf(contact) ? " (archived)" : ""}</strong>
                <div className="flex gap-2">
                  {contact.relationship.effectiveTo === null ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "endRelationship", relationshipId: contact.relationship.id }, "Contact ended (kept in history).")}>End contact</Button>
                  ) : archivedOf(contact) ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "restorePerson", personId: contact.person.id }, "Person restored.")}>Restore person</Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "archivePerson", personId: contact.person.id }, "Person archived (kept in history).")}>Archive person</Button>
                  )}
                </div>
              </div>
              <div className="text-muted-foreground">
                {contact.current.titles.map((title) => (
                  <span key={title.id} className="mr-3">{title.titleDisplay} <button type="button" className="underline text-[11px]" disabled={busy} onClick={() => act({ action: "endTitle", titleId: title.id }, "Title ended.")}>end</button></span>
                ))}
                {contact.current.titles.length === 0 ? "No title recorded" : null}
              </div>
              <div className="flex flex-wrap gap-2 text-muted-foreground">
                {contact.current.purposes.map((p) => (
                  <span key={p.id} className="rounded-full border px-2 py-0.5 text-[11px]">
                    {p.isPrimary ? `${p.purpose} (primary)` : p.purpose}{" "}
                    {p.isPrimary ? null : <button type="button" className="underline" disabled={busy} onClick={() => act({ action: "makePrimary", relationshipId: contact.relationship.id, purpose: p.purpose }, "Primary updated.")}>make primary</button>}{" "}
                    <button type="button" className="underline" disabled={busy} onClick={() => act({ action: "endPurpose", assignmentId: p.id }, "Purpose ended.")}>end</button>
                  </span>
                ))}
                {contact.current.purposes.length === 0 ? "No purpose recorded" : null}
              </div>
              {contact.current.channels.map((channel) => (
                <div key={channel.id}>{channel.channelType === "PHONE" ? "Phone" : channel.channelType === "WEBSITE" ? "Website" : "Email"}: {channel.valueDisplay}{" "}
                  <button type="button" className="underline text-[11px]" disabled={busy} onClick={() => act({ action: "endPersonChannel", personId: contact.person.id, channelId: channel.id }, "Line ended.")}>end</button>
                </div>
              ))}
              {contact.relationship.effectiveTo !== null ? null : (
                <details>
                  <summary className="cursor-pointer text-xs font-semibold">Edit</summary>
                  <div className="grid sm:grid-cols-2 gap-3 pt-2">
                    <form
                      className="space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        const form = new FormData(event.currentTarget)
                        void act({ action: String(form.get("mode")) === "correct" ? "correctName" : "changeName", personId: contact.person.id, givenName: String(form.get("given") ?? ""), familyName: String(form.get("family") ?? "") }, "Name saved.")
                      }}
                    >
                      <div className="grid grid-cols-2 gap-2"><Input name="given" defaultValue={contact.current.name?.givenName ?? ""} aria-label="Given name" /><Input name="family" defaultValue={contact.current.name?.familyName ?? ""} aria-label="Family name" /></div>
                      <label className="flex items-center gap-2 text-xs"><input type="radio" name="mode" value="change" defaultChecked /> The name changed (keep the old name as history)</label>
                      <label className="flex items-center gap-2 text-xs"><input type="radio" name="mode" value="correct" /> The recorded name was wrong (correct it)</label>
                      <Button size="sm" type="submit" disabled={busy}>Save name</Button>
                    </form>
                    <form
                      className="space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        const form = new FormData(event.currentTarget)
                        const title = String(form.get("title") ?? "").trim()
                        const purpose = String(form.get("purpose") ?? "")
                        if (title) void act({ action: "addTitle", relationshipId: contact.relationship.id, title }, "Title added.")
                        if (purpose) void act({ action: "assignPurpose", relationshipId: contact.relationship.id, purpose, primary: form.get("primary") === "on" }, "Purpose added.")
                        event.currentTarget.reset()
                      }}
                    >
                      <Input name="title" placeholder="Add a title" aria-label="Add title" />
                      <div className="flex gap-2">
                        <select name="purpose" aria-label="Add purpose" className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"><option value="">Add a purpose…</option>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select>
                        <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="primary" /> primary</label>
                      </div>
                      <Button size="sm" type="submit" disabled={busy}>Add</Button>
                    </form>
                  </div>
                </details>
              )}
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
