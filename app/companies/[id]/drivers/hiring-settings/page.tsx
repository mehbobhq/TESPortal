"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Rule = "ALLOWED" | "RESTRICTED" | "PROHIBITED"
type Item = { id: string; title: string; description: string; rules: Record<"US" | "CA", Record<"PRE_OFFER" | "CONDITIONAL_OFFER" | "POST_OFFER", Rule>> }
type Profile = { version: number; selections: Record<string, { enabled: boolean; acknowledgedRestriction?: boolean }>; items: Item[]; legalNotice: string }

const STAGES = [["PRE_OFFER", "Before an offer"], ["CONDITIONAL_OFFER", "After a conditional offer"], ["POST_OFFER", "After hiring"]] as const
const tone: Record<Rule, string> = { ALLOWED: "text-emerald-700", RESTRICTED: "text-yellow-800", PROHIBITED: "text-red-700" }
const word: Record<Rule, string> = { ALLOWED: "Allowed", RESTRICTED: "Restricted", PROHIBITED: "Not available" }

/** The carrier's own screening choices. The legal matrix decides what can be switched on; it is a configuration aid, not legal advice. */
export default function HiringSettingsPage() {
  const { id } = useParams() as { id: string }
  const [profile, setProfile] = useState<Profile | null>(null)
  const [selections, setSelections] = useState<Profile["selections"]>({})
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/companies/${encodeURIComponent(id)}/driver-hiring-profile`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error ?? "Unable to load.")
        setProfile(body)
        setSelections(body.selections ?? {})
      })
      .catch((e) => setMessage({ tone: "error", text: e instanceof Error ? e.message : "Unable to load." }))
  }, [id])

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const r = await fetch(`/api/companies/${encodeURIComponent(id)}/driver-hiring-profile`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selections }) })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error ?? "Unable to save.")
      setMessage({ tone: "ok", text: `Saved (version ${body.version}). New applications use these choices; applications already sent keep theirs.` })
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Unable to save." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 pb-10 sm:p-6">
      <div>
        <Link href={`/companies/${id}/drivers`} className="text-sm text-primary underline">← Drivers</Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Hiring application settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose the carrier-specific questions and checks that are added to the regulatory application. {profile?.legalNotice}</p>
      </div>
      {message ? <p role="status" className={`text-sm ${message.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p> : null}
      {!profile ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {profile?.items.map((item) => {
        const sel = selections[item.id] ?? { enabled: false }
        const never = (["US", "CA"] as const).every((c) => STAGES.every(([s]) => item.rules[c][s] === "PROHIBITED"))
        const restricted = (["US", "CA"] as const).some((c) => STAGES.some(([s]) => item.rules[c][s] === "RESTRICTED"))
        return (
          <Card key={item.id}>
            <CardHeader className="border-b bg-muted/30 py-3"><CardTitle className="text-sm">{item.title}</CardTitle></CardHeader>
            <CardContent className="space-y-3 pt-4 text-sm">
              <p className="text-muted-foreground">{item.description}</p>
              <div className="grid gap-1 text-xs sm:grid-cols-2">
                {(["US", "CA"] as const).map((c) => (
                  <p key={c}><span className="font-semibold">{c === "US" ? "United States" : "Canada"}:</span>{" "}
                    {STAGES.map(([s, label]) => <span key={s} className={`mr-2 ${tone[item.rules[c][s]]}`}>{label}: {word[item.rules[c][s]]}</span>)}
                  </p>
                ))}
              </div>
              {never ? <p className="text-xs font-medium text-red-700">This cannot be used.</p> : (
                <>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={sel.enabled} onChange={(e) => setSelections({ ...selections, [item.id]: { ...sel, enabled: e.target.checked } })} />Use this in new applications</label>
                  {restricted && sel.enabled ? (
                    <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={sel.acknowledgedRestriction === true} onChange={(e) => setSelections({ ...selections, [item.id]: { ...sel, acknowledgedRestriction: e.target.checked } })} />I understand this is restricted in some situations and have confirmed with legal counsel that I may use it. It is only added where the driver’s operations allow it.</label>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        )
      })}
      {profile ? <div><Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save settings"}</Button></div> : null}
    </div>
  )
}
