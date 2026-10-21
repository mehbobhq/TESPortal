"use client"

import { CompanyMissing } from "@/components/company-missing"
import { readCompanyLookup } from "@/lib/company-lookup"
import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const CATEGORIES = ["FLEET", "COMPLIANCE", "REGISTRATION", "INSURANCE", "ACCOUNTING", "FUEL", "OTHER"]
const MFA_METHODS = ["NONE", "AUTHENTICATOR_APP", "SMS", "EMAIL", "HARDWARE_KEY", "OTHER"]
const STATUSES = ["ACTIVE", "NEEDS_VERIFICATION", "LOCKED", "DISABLED"]

type CredentialView = {
  credential: { id: string; username: string; category: string; mfaMethod: string | null; recordStatus: string }
  system: { id: string; displayName: string; loginUrl?: string | null }
  currentStatus: { status: string } | null
  lastVerification: { outcome: string; method: string; verifiedAt: string } | null
  slots: { id: string; slotKind: string; secretState: string }[]
}
type System = { id: string; displayName: string; loginUrl?: string | null }
type Company = { id: string; name: string; kind: string; status: string }

/**
 * The canonical (PostgreSQL-backed) Credentials workspace. Kept intact (mechanical export change only) but NOT rendered by the Credentials
 * route (see ./page.tsx) and not a route itself. Its API, services, tables and authorization are unchanged. It never accepts or returns a
 * secret value. Re-mounting it is a deliberate product decision.
 */
export function CanonicalCredentials() {
  const params = useParams()
  const companyId = params.id as string
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const [company, setCompany] = useState<Company | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [credentials, setCredentials] = useState<CredentialView[]>([])
  const [systems, setSystems] = useState<System[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("ALL")
  const [verification, setVerification] = useState({ outcome: "VERIFIED", method: "MANUAL_LOGIN" })
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [profile, list, sys] = await Promise.all([
        fetch(`${base}/profile`, { cache: "no-store" }),
        fetch(`${base}/credentials`, { cache: "no-store" }),
        fetch("/api/credential-systems", { cache: "no-store" }),
      ])
      {
          const lookup = await readCompanyLookup<Company>(profile)
          setCompany(lookup.company)
          setLookupFailed(lookup.failed)
        }
      if (list.ok) setCredentials((await list.json()).credentials ?? [])
      else setError((await list.json().catch(() => null))?.error ?? "Unable to load credentials.")
      if (sys.ok) setSystems((await sys.json()).systems ?? [])
    } catch {
      setError("Unable to load credentials.")
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  async function send(url: string, method: "POST" | "PATCH", payload: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      if (!response.ok) {
        setError((await response.json().catch(() => null))?.error ?? "The change could not be saved.")
        return false
      }
      await load()
      return true
    } catch {
      setError("The change could not be saved.")
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateSystem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const payload: Record<string, unknown> = { name: String(data.get("name") ?? "").trim() }
    const loginUrl = String(data.get("loginUrl") ?? "").trim()
    if (loginUrl) payload.loginUrl = loginUrl
    if (await send("/api/credential-systems", "POST", payload)) form.reset()
  }

  async function handleCreateCredential(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const field = (name: string) => String(data.get(name) ?? "").trim()
    // A newly recorded login has not been verified yet (the original workspace started every credential as "Needs verification").
    const payload: Record<string, unknown> = { systemId: field("systemId"), category: field("category"), username: field("username"), status: "NEEDS_VERIFICATION" }
    if (field("mfaMethod")) payload.mfaMethod = field("mfaMethod")
    if (await send(`${base}/credentials`, "POST", payload)) form.reset()
  }

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <CompanyMissing failed={lookupFailed} />

  return (
    <div className="flex flex-col gap-6 pb-10">
      <CompanyWorkspaceHeader company={company} section="Credentials" />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b">
          <CardTitle className="text-sm">Credentials on record</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <Input
              aria-label="Search credentials"
              placeholder="Search portal, username…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="max-w-xs"
            />
            {["ALL", ...CATEGORIES].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCategoryFilter(value)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${categoryFilter === value ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}
              >
                {value === "ALL" ? "All" : value.charAt(0) + value.slice(1).toLowerCase()}
              </button>
            ))}
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Verify as
              <select aria-label="Verification outcome" className="rounded-md border bg-background px-1 py-0.5" value={verification.outcome} onChange={(event) => setVerification((current) => ({ ...current, outcome: event.target.value }))}>
                {["VERIFIED", "FAILED", "LOCKED_OUT"].map((value) => <option key={value}>{value}</option>)}
              </select>
              via
              <select aria-label="Verification method" className="rounded-md border bg-background px-1 py-0.5" value={verification.method} onChange={(event) => setVerification((current) => ({ ...current, method: event.target.value }))}>
                {["MANUAL_LOGIN", "PORTAL_CHECK", "CLIENT_CONFIRMATION"].map((value) => <option key={value}>{value}</option>)}
              </select>
            </span>
          </div>
          {credentials.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No credentials yet.</p>
          ) : (
            <div className="flex flex-col divide-y">
              {credentials
                .filter((view) => categoryFilter === "ALL" || view.credential.category === categoryFilter)
                .filter((view) => !query.trim() || `${view.system.displayName} ${view.credential.username}`.toLowerCase().includes(query.trim().toLowerCase()))
                .map((view) => {
                const archived = view.credential.recordStatus === "archived"
                const url = `${base}/credentials/${view.credential.id}`
                return (
                  <div key={view.credential.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {view.system.displayName} — {view.credential.username}
                        {archived ? " (archived)" : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {view.credential.category} · {view.currentStatus?.status ?? "—"} · MFA {view.credential.mfaMethod ?? "—"}
                        {view.lastVerification ? ` · last check ${view.lastVerification.outcome} (${view.lastVerification.verifiedAt.slice(0, 10)})` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Secrets are never shown here.{" "}
                        {view.slots.map((slot) => `${slot.slotKind}: ${slot.secretState}`).join("; ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Change status"
                        className="rounded-md border bg-background px-2 py-1 text-xs"
                        value=""
                        disabled={busy || archived}
                        onChange={(event) => {
                          if (event.target.value) void send(url, "PATCH", { action: "status", status: event.target.value })
                        }}
                      >
                        <option value="">Change status…</option>
                        {STATUSES.filter((value) => value !== view.currentStatus?.status).map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || archived}
                        onClick={() => void send(url, "PATCH", { action: "verify", outcome: verification.outcome, method: verification.method })}
                      >
                        Record check
                      </Button>
                      {systems.find((system) => system.id === view.system.id)?.loginUrl ? (
                        <a href={systems.find((system) => system.id === view.system.id)?.loginUrl ?? undefined} target="_blank" rel="noopener noreferrer" className="rounded-md border px-2 py-1 text-xs font-semibold hover:bg-muted">
                          Open portal
                        </a>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void send(url, "PATCH", { action: archived ? "restore" : "archive" })}
                      >
                        {archived ? "Restore" : "Archive"}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b">
          <CardTitle className="text-sm">Add credential</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleCreateCredential} className="grid sm:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label htmlFor="systemId">Portal / system</Label>
              <select id="systemId" name="systemId" required className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                <option value="">Select…</option>
                {systems.map((system) => (
                  <option key={system.id} value={system.id}>{system.displayName}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="category">Category</Label>
              <select id="category" name="category" required className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                {CATEGORIES.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="username">Username</Label>
              <Input id="username" name="username" required autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mfaMethod">MFA method</Label>
              <select id="mfaMethod" name="mfaMethod" className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                <option value="">—</option>
                {MFA_METHODS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-4 flex justify-end">
              <Button type="submit" disabled={busy}>Save credential</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b">
          <CardTitle className="text-sm">Add portal / system</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleCreateSystem} className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loginUrl">Login URL</Label>
              <Input id="loginUrl" name="loginUrl" type="url" />
            </div>
            <div className="flex items-end justify-end">
              <Button type="submit" disabled={busy}>Save system</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Passwords and other secrets are never entered or stored in this browser. Secret values live only in the secret manager and are
        attached by reference; storing them is deferred until the secret-handling workflow is approved.
      </p>
    </div>
  )
}
