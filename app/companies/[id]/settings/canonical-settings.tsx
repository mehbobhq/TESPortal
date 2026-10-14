"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type Rule = { code: string; section: string; displayName: string; appliesToRegion: string }
type RuleEntry = { rule: Rule; assertion: { applicability: "APPLIES" | "DOES_NOT_APPLY" } | null; effective: string; source: string }
type Profile = {
  operatingScope: { assertion: { operatingScope: string } | null }
  driverRequirements: { assertion: { minimumDriverAgeYears: number; minimumDriverExperienceMonths: number } | null }
  rules: RuleEntry[]
}

const SCOPES = [
  { value: "CANADA", label: "Canada only" },
  { value: "UNITED_STATES", label: "United States only" },
  { value: "CANADA_AND_UNITED_STATES", label: "Canada and United States (cross-border)" },
]

/**
 * Company operating profile from the canonical company-profile domain (PostgreSQL): operating scope, driver minimums and the
 * applicability of each catalogued rule. "Not configured" is shown as exactly that, never as a default the company did not choose.
 */
export function CanonicalSettings({ companyId }: { companyId: string }) {
  const base = `/api/companies/${encodeURIComponent(companyId)}/settings`
  const [profile, setProfile] = useState<Profile | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(base, { cache: "no-store" })
      if (response.status === 403) return setState("denied")
      if (!response.ok) return setState("error")
      setProfile(await response.json())
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
        setMessage((await response.json().catch(() => null))?.error ?? "The setting could not be saved.")
        return
      }
      setMessage(done)
      await load()
    } catch {
      setMessage("The setting could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  if (state === "loading") return <div className="p-10 text-center text-sm">Loading settings...</div>
  if (state === "denied") return <div className="p-10 text-center text-sm">You are not permitted to view this company's operating profile.</div>
  if (state === "error" || !profile) return <div className="p-10 text-center text-sm">Settings could not be loaded. This is a temporary error, not an empty profile.</div>

  const scope = profile.operatingScope.assertion?.operatingScope ?? null
  const minimums = profile.driverRequirements.assertion
  const sections = [...new Set(profile.rules.map((entry) => entry.rule.section))]

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl">
      <h1 className="text-xl font-semibold">Settings</h1>
      {message ? <p role="status" className="text-sm">{message}</p> : null}

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle className="text-sm">Operating scope</CardTitle></CardHeader>
        <CardContent className="pt-4 flex items-center gap-3">
          <select
            aria-label="Operating scope"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={scope ?? ""}
            disabled={busy}
            onChange={(event) => event.target.value && void act({ action: "setOperatingScope", operatingScope: event.target.value }, "Operating scope saved.")}
          >
            <option value="" disabled>Not recorded</option>
            {SCOPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          {scope ? null : <span className="text-sm text-muted-foreground">No operating scope has been recorded.</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle className="text-sm">Driver minimums</CardTitle></CardHeader>
        <CardContent className="pt-4">
          <form
            key={`${minimums?.minimumDriverAgeYears ?? "n"}-${minimums?.minimumDriverExperienceMonths ?? "n"}`}
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              void act({ action: "setDriverRequirements", minimumDriverAgeYears: Number(form.get("age")), minimumDriverExperienceMonths: Number(form.get("experience")) }, "Driver minimums saved.")
            }}
          >
            <label className="text-sm space-y-1">Minimum age (years)<Input name="age" type="number" min={0} defaultValue={minimums?.minimumDriverAgeYears ?? ""} required /></label>
            <label className="text-sm space-y-1">Minimum experience (months)<Input name="experience" type="number" min={0} defaultValue={minimums?.minimumDriverExperienceMonths ?? ""} required /></label>
            <Button type="submit" disabled={busy}>Save</Button>
            {minimums ? null : <span className="text-sm text-muted-foreground">No driver minimums have been recorded.</span>}
          </form>
        </CardContent>
      </Card>

      {sections.map((section) => (
        <Card key={section}>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm">{section.replaceAll("_", " ")}</CardTitle></CardHeader>
          <CardContent className="pt-4 space-y-2">
            {profile.rules.filter((entry) => entry.rule.section === section).map((entry) => (
              <div key={entry.rule.code} className="flex items-center justify-between text-sm gap-3">
                <span>{entry.rule.displayName} <span className="text-muted-foreground">({entry.effective.replaceAll("_", " ").toLowerCase()})</span></span>
                <span className="flex gap-2">
                  <Button size="sm" variant={entry.assertion?.applicability === "APPLIES" ? "default" : "outline"} disabled={busy} onClick={() => act({ action: "setRuleApplicability", ruleCode: entry.rule.code, applicability: "APPLIES" }, "Rule saved.")}>Applies</Button>
                  <Button size="sm" variant={entry.assertion?.applicability === "DOES_NOT_APPLY" ? "default" : "outline"} disabled={busy} onClick={() => act({ action: "setRuleApplicability", ruleCode: entry.rule.code, applicability: "DOES_NOT_APPLY" }, "Rule saved.")}>Does not apply</Button>
                  <Button size="sm" variant="outline" disabled={busy || !entry.assertion} onClick={() => act({ action: "clearRuleApplicability", ruleCode: entry.rule.code }, "Rule cleared (kept in history).")}>Clear</Button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground">Settings saved only in a browser by the earlier prototype are not shown here. They were not deleted.</p>
    </div>
  )
}
