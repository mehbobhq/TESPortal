"use client"

import { useState } from "react"
import { ShieldCheck, X } from "lucide-react"

import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { userMessage } from "@/lib/canonical-ui/unavailable"
import {
  CATEGORY_LABEL,
  MFA_LABEL,
  SLOT_LABEL,
  STATUS_LABEL,
  type CanonicalCategory,
  type CanonicalCredentials,
  type CanonicalMfa,
  type CanonicalSlotKind,
  type CanonicalStatus,
  type CredentialRow,
  type PortalDefinition,
} from "@/src/restored/credentials/adapter"

/**
 * Per-credential management surface. The original table only offered "open portal"; the canonical domain also carries status
 * history, verification facts, metadata, login replacement, recovery slots and archive, so those controls live here, using the
 * same visual language. Real-world change keeps history; a mistaken value is CORRECTED (flagged), never overwritten. Nothing
 * here accepts a secret value: slots record that a secret exists, and may be linked to a Secret Manager resource NAME.
 */

const STATUS_CODES = Object.keys(STATUS_LABEL) as CanonicalStatus[]
const SLOT_CODES = Object.keys(SLOT_LABEL) as CanonicalSlotKind[]
const VERIFICATION_METHODS = ["MANUAL_LOGIN", "PORTAL_CHECK", "CLIENT_CONFIRMATION"]
const VERIFICATION_OUTCOMES = ["VERIFIED", "FAILED", "LOCKED_OUT"] as const

const field = "h-9 rounded-md border border-input bg-background px-2 text-sm"

function when(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

export function CredentialDetailDialog({ row, portal, api, onClose }: { row: CredentialRow; portal: PortalDefinition | null; api: CanonicalCredentials; onClose: () => void }) {
  const view = row.view
  const archived = row.archived
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [nextStatus, setNextStatus] = useState<CanonicalStatus | "">("")
  const [outcome, setOutcome] = useState<(typeof VERIFICATION_OUTCOMES)[number]>("VERIFIED")
  const [method, setMethod] = useState(VERIFICATION_METHODS[0])
  const [category, setCategory] = useState<CanonicalCategory>(view.credential.category)
  const [mfa, setMfa] = useState<CanonicalMfa | "">(view.credential.mfaMethod ?? "")
  const [newUsername, setNewUsername] = useState("")
  const [replaceReason, setReplaceReason] = useState<"USERNAME_CHANGED" | "CORRECTION">("USERNAME_CHANGED")
  const [slotKind, setSlotKind] = useState<CanonicalSlotKind>("RECOVERY_EMAIL")
  const [linking, setLinking] = useState<string | null>(null)
  const [resourceName, setResourceName] = useState("")
  const [portalName, setPortalName] = useState(portal?.name ?? "")
  const [portalUrl, setPortalUrl] = useState(portal?.loginUrl ?? "")
  const [alias, setAlias] = useState("")

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await work()
      if (done) setMessage(done)
    } catch (err) {
      setError(userMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const current = view.currentStatus
  const metadataDirty = category !== view.credential.category || (mfa !== "" && mfa !== view.credential.mfaMethod)
  const liveSlots = view.slots.filter((slot) => slot.secretState !== "RETIRED")
  const systemAliases = api.systems.find((system) => system.id === row.portalId)?.aliases.filter((item) => item.recordStatus === "active") ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div role="dialog" aria-label="Manage credential" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">
              {portal?.name ?? view.system.displayName}
              {archived ? <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">Archived</span> : null}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {row.username} · {row.category} · MFA {view.credential.mfaMethod ? MFA_LABEL[view.credential.mfaMethod] : "not recorded"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-7 overflow-y-auto px-6 py-5">
          {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
          {message ? <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
          {archived ? <p className="text-xs text-muted-foreground">This credential is archived. Restore it to change its status, record verifications or edit it. Its history stays on record.</p> : null}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Status</h3>
            <p className="text-xs text-muted-foreground">
              Current: <strong>{current ? STATUS_LABEL[current.status] : "—"}</strong> since {when(current?.effectiveFrom)}. A real-world change keeps the earlier status as history; use Correct only when the recorded status was
              wrong.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="New status" className={field} value={nextStatus} disabled={busy || archived} onChange={(event) => setNextStatus(event.target.value as CanonicalStatus | "")}>
                <option value="">Select status…</option>
                {STATUS_CODES.filter((code) => code !== current?.status).map((code) => (
                  <option key={code} value={code}>
                    {STATUS_LABEL[code]}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" disabled={busy || archived || !nextStatus} onClick={() => void run(() => api.changeStatus(row.id, nextStatus as CanonicalStatus), "Status changed; the previous status is kept as history.")}>
                Change status
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || archived || !nextStatus || !current}
                onClick={() => current && void run(() => api.correctStatus(row.id, current.id, nextStatus as CanonicalStatus), "Status corrected; the mistaken entry is kept and flagged.")}
              >
                Correct status
              </Button>
            </div>
            <ul className="divide-y rounded-lg border text-xs">
              {view.statusHistory.map((period) => (
                <li key={period.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    <strong>{STATUS_LABEL[period.status]}</strong> · {when(period.effectiveFrom)} → {period.effectiveTo ? when(period.effectiveTo) : "now"}
                  </span>
                  <span className="text-muted-foreground">{period.recordStatus === "corrected" ? "corrected (kept)" : period.reason.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Verification</h3>
            <p className="text-xs text-muted-foreground">Records who verified the login and when. It does not change the status; that is a separate decision above.</p>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Verification outcome" className={field} value={outcome} disabled={busy || archived} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>
                {VERIFICATION_OUTCOMES.map((code) => (
                  <option key={code} value={code}>
                    {code.replaceAll("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
              <select aria-label="Verification method" className={field} value={method} disabled={busy || archived} onChange={(event) => setMethod(event.target.value)}>
                {VERIFICATION_METHODS.map((code) => (
                  <option key={code} value={code}>
                    {code.replaceAll("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" disabled={busy || archived} onClick={() => void run(() => api.recordVerification(row.id, outcome, method), "Verification recorded.")}>
                Record verification
              </Button>
            </div>
            {view.verifications.length === 0 ? (
              <p className="text-xs text-muted-foreground">No verification recorded yet.</p>
            ) : (
              <ul className="divide-y rounded-lg border text-xs">
                {view.verifications.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className={item.recordStatus === "voided" ? "line-through opacity-60" : ""}>
                      <strong>{item.outcome.replaceAll("_", " ").toLowerCase()}</strong> · {item.method.replaceAll("_", " ").toLowerCase()} · {when(item.verifiedAt)}
                    </span>
                    {item.recordStatus === "voided" ? (
                      <span className="text-muted-foreground">voided (kept)</span>
                    ) : (
                      <button type="button" disabled={busy} className="text-muted-foreground hover:text-destructive" onClick={() => void run(() => api.voidVerification(row.id, item.id), "Verification voided; it stays on record, flagged.")}>
                        Void (entered in error)
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Category and MFA method</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Category" className={field} value={category} disabled={busy || archived} onChange={(event) => setCategory(event.target.value as CanonicalCategory)}>
                {(Object.keys(CATEGORY_LABEL) as CanonicalCategory[]).map((code) => (
                  <option key={code} value={code}>
                    {CATEGORY_LABEL[code]}
                  </option>
                ))}
              </select>
              <select aria-label="MFA method" className={field} value={mfa} disabled={busy || archived} onChange={(event) => setMfa(event.target.value as CanonicalMfa | "")}>
                <option value="">Not recorded</option>
                {(Object.keys(MFA_LABEL) as CanonicalMfa[]).map((code) => (
                  <option key={code} value={code}>
                    {MFA_LABEL[code]}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || archived || !metadataDirty}
                onClick={() => {
                  const fields: { category?: CanonicalCategory; mfaMethod?: CanonicalMfa } = {}
                  if (category !== view.credential.category) fields.category = category
                  if (mfa && mfa !== view.credential.mfaMethod) fields.mfaMethod = mfa
                  void run(() => api.updateMetadata(row.id, fields), "Details saved.")
                }}
              >
                Save details
              </Button>
            </div>
            {mfa === "" && view.credential.mfaMethod ? <CanonicalUnavailable action="Clearing the MFA method" reason="a recorded MFA method can be changed to another value but not removed; choose None if the account has no MFA." /> : null}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Login (username)</h3>
            <p className="text-xs text-muted-foreground">A username cannot be edited in place. Replacing it creates a new credential that points at this one; this credential is archived with its history intact.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="New username" className="h-9 max-w-xs" value={newUsername} disabled={busy || archived} onChange={(event) => setNewUsername(event.target.value)} placeholder="New username or account email" autoComplete="off" />
              <select aria-label="Reason" className={field} value={replaceReason} disabled={busy || archived} onChange={(event) => setReplaceReason(event.target.value as typeof replaceReason)}>
                <option value="USERNAME_CHANGED">The username changed</option>
                <option value="CORRECTION">The username was entered wrongly</option>
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || archived || !newUsername.trim()}
                onClick={() =>
                  void run(async () => {
                    await api.replaceLogin(row.id, newUsername.trim(), replaceReason)
                    onClose()
                    api.setNotice("The login was replaced. The previous credential is archived (use Show archived to see it).")
                  })
                }
              >
                Replace login
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4" /> Passwords and recovery
            </h3>
            <p className="text-xs text-muted-foreground">
              Secrets live in the secret manager, not in TES. Each slot below records that a secret exists and its state (<em>unresolved</em> means no secret-manager reference is linked yet). Values are never shown, entered or stored here.
            </p>
            {liveSlots.length === 0 ? (
              <p className="text-xs text-muted-foreground">No live secret slots.</p>
            ) : (
              <ul className="divide-y rounded-lg border text-xs">
                {liveSlots.map((slot) => (
                  <li key={slot.id} className="space-y-2 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        <strong>{SLOT_LABEL[slot.slotKind]}</strong> · {slot.secretState === "STORED" ? "linked to the secret manager" : "unresolved"}
                      </span>
                      <span className="flex gap-3">
                        {slot.secretState === "UNRESOLVED" && !archived ? (
                          <button type="button" className="text-primary hover:underline" onClick={() => { setLinking(linking === slot.id ? null : slot.id); setResourceName("") }}>
                            Link secret-manager resource
                          </button>
                        ) : null}
                        <button type="button" disabled={busy} className="text-muted-foreground hover:text-destructive" onClick={() => void run(() => api.retireSlot(row.id, slot.id), "Slot retired; it stays on record.")}>
                          Retire
                        </button>
                      </span>
                    </div>
                    {linking === slot.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input aria-label="Secret Manager resource name" className="h-9 max-w-md font-mono text-xs" value={resourceName} onChange={(event) => setResourceName(event.target.value)} placeholder="projects/<project>/secrets/<name>" autoComplete="off" />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || !resourceName.trim()}
                          onClick={() =>
                            void run(async () => {
                              await api.linkSecret(row.id, slot.id, resourceName.trim())
                              setLinking(null)
                              setResourceName("")
                            }, "Linked. Only the resource name was recorded; it is never displayed.")
                          }
                        >
                          Link
                        </Button>
                        <span className="text-[11px] text-muted-foreground">A resource NAME only, never the secret itself.</span>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Slot kind" className={field} value={slotKind} disabled={busy || archived} onChange={(event) => setSlotKind(event.target.value as CanonicalSlotKind)}>
                {SLOT_CODES.map((code) => (
                  <option key={code} value={code}>
                    {SLOT_LABEL[code]}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" disabled={busy || archived} onClick={() => void run(() => api.declareSlot(row.id, slotKind), "Slot declared (no value recorded).")}>
                Declare recovery item
              </Button>
            </div>
            <CanonicalUnavailable action="Security question text, recovery labels and values" reason="no column holds them (approved decision) and secret values are never stored in TES. Only the existence and state of each secret is recorded." />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Portal / system (shared registry)</h3>
            <p className="text-xs text-muted-foreground">The portal record is global: changing it affects every company that uses this portal.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="Portal name" className="h-9 max-w-xs" value={portalName} onChange={(event) => setPortalName(event.target.value)} />
              <Input aria-label="Login URL" className="h-9 max-w-xs" value={portalUrl} onChange={(event) => setPortalUrl(event.target.value)} placeholder="https:// login page" />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !portal || (portalName.trim() === portal.name && portalUrl.trim() === portal.loginUrl) || !portalName.trim()}
                onClick={() => {
                  if (!portal) return
                  const fields: Record<string, unknown> = {}
                  if (portalName.trim() !== portal.name) fields.name = portalName.trim()
                  if (portalUrl.trim() !== portal.loginUrl && portalUrl.trim()) fields.loginUrl = portalUrl.trim()
                  if (Object.keys(fields).length === 0) {
                    setError("A login URL can be changed but not removed once recorded.")
                    return
                  }
                  void run(() => api.updateSystem(portal.id, fields), "Portal updated.")
                }}
              >
                Save portal
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {systemAliases.map((item) => (
                <span key={item.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
                  {item.alias}
                  <button type="button" aria-label={`Retire alias ${item.alias}`} disabled={busy} onClick={() => void run(() => api.retireAlias(row.portalId, item.id), "Alias retired.")}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <Input aria-label="New alias" className="h-8 max-w-[10rem] text-xs" value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="Add alias" />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !alias.trim()}
                onClick={() =>
                  void run(async () => {
                    await api.addAlias(row.portalId, alias.trim())
                    setAlias("")
                  }, "Alias added.")
                }
              >
                Add alias
              </Button>
            </div>
            <CanonicalUnavailable action="Portal legal name and services" reason={api.unavailable.portalServices().reason} />
          </section>
        </div>

        <div className="flex items-center justify-between border-t px-6 py-4">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => api.setArchived(row.id, !archived), archived ? "Credential restored." : "Credential archived; its history is kept.")}>
            {archived ? "Restore credential" : "Archive credential"}
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}

