"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, FileCheck2 } from "lucide-react"

import { ACTIVITY_GROUPS } from "@/lib/company-changes/definitions"
import { LegalNameChange } from "@/src/components/company/LegalNameChange"

type Evidence = { documentId: string; role: string; title: string | null }
type Entry = {
  id: string; operation: string; label: string; group: string; summary: string; previousValue: string | null; newValue: string | null
  effectiveAt: string; recordedAt: string; requestSource: string | null; basis: string | null; basisReference: string | null; evidence: Evidence[]
  actor: { ref: string; type: string | null; you: boolean } | null; registerEventId: string | null
}
type LegalPending = { id: string; previousLegalName: string; requestedLegalName: string; requesterBasis: string }
type ChannelPending = { id: string; channelType: string; usage: string; changeKind: "REPLACE" | "REMOVE"; previousValue: string | null; requestedValue: string | null; requestSource: string; requestReference: string; senderAddress: string | null; recordedAt: string; recordedByYou?: boolean }
type EvidenceItem = { documentId: string; documentType: string; documentTitle: string; documentStatus: string; createdAt: string; payload: { state: string; integrityVerified: boolean } }
type Candidate = { kind: "PERSON_CHANNEL" | "COMPANY_CHANNEL"; id: string; label: string; createdAt?: string }

const ROLE_LABEL: Record<string, string> = {
  GOVERNMENT_DOCUMENT: "Government document", WRITTEN_REQUEST: "Written request", DIRECTOR_VERIFICATION: "Director verification", REGISTRATION: "Registration evidence", CONFIRMATION: "Confirmation",
}
const SOURCE_LABEL: Record<string, string> = {
  COMPANY_WRITTEN_REQUEST: "company written request", COMPANY_VERBAL_CONFIRMED: "company verbal instruction (confirmed)", VERIFIED_CHANNEL_CONFIRMATION: "confirmed through an established channel", STAFF_ENTRY: "TES staff entry",
}

const ACTOR_TYPE: Record<string, string> = { HUMAN: "TES staff", SYSTEM: "System", AUTOMATION: "Automation", INTEGRATION: "Integration", SERVICE_ACCOUNT: "Service account" }

/** Actors carry no personal name in the canonical model: the viewer sees "You", otherwise the actor type and its stable short reference. */
const actorText = (actor: NonNullable<Entry["actor"]>) => (actor.you ? "you" : `${actor.type ? (ACTOR_TYPE[actor.type] ?? actor.type) : "TES actor"} (ref ${actor.ref})`)

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ""
  const diff = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diff < 60) return "Just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * Company Activity: one entry per BUSINESS operation (Legal Name Changed, DBA Added, Website Updated, Company Email Changed, Company Phone
 * Changed, Address Updated, Primary Contact Changed ...), with the supporting evidence linked. The Master Register keeps every technical event.
 * Pending changes (a legal-name request, a channel replacement awaiting confirmation) are shown separately: they are NOT yet effective.
 */
export function CompanyActivityPanel({ companyId, companyName, onChanged }: { companyId: string; companyName: string; onChanged?: () => void }) {
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const [state, setState] = useState<"loading" | "denied" | "error" | "unavailable" | "ready">("loading")
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [pending, setPending] = useState<{ legalName: LegalPending[]; channels: ChannelPending[] }>({ legalName: [], channels: [] })
  const [access, setAccess] = useState({ evidence: false, execute: false })
  const [filter, setFilter] = useState("all")
  const [limit, setLimit] = useState(20)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([])
  const [legalOpen, setLegalOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${base}/changes`, { cache: "no-store" })
      if (response.status === 403) return setState("denied")
      if (!response.ok) return setState("error")
      const body = await response.json()
      if (body.tracking && body.tracking !== "COMPLETE") {
        setUnavailable(body.message ?? "The company change history is not available yet.")
        return setState("unavailable")
      }
      setEntries(body.entries ?? [])
      setPending(body.pending ?? { legalName: [], channels: [] })
      setAccess(body.access ?? { evidence: false, execute: false })
      setState("ready")
    } catch {
      setState("error")
    }
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  // The established channels a confirmation may use (the server still proves each one is established and not the requested value or sender).
  useEffect(() => {
    if (pending.channels.length === 0) return setEvidenceItems([])
    fetch(`${base}/evidence`, { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((body) => setEvidenceItems((body?.evidence ?? []) as EvidenceItem[]))
      .catch(() => setEvidenceItems([]))
  }, [base, pending.channels.length])

  useEffect(() => {
    if (pending.channels.length === 0) return setCandidates([])
    fetch(`${base}/contacts`, { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((view) => {
        if (!view) return
        const list: Candidate[] = []
        for (const c of view.currentChannels ?? []) list.push({ kind: "COMPANY_CHANNEL", id: c.id, label: `Company ${String(c.channelType).toLowerCase()}${c.usage ? ` (${String(c.usage).toLowerCase()})` : ""}: ${c.valueDisplay}`, createdAt: c.createdAt })
        for (const contact of view.contacts ?? []) {
          if (contact.relationship.effectiveTo !== null) continue
          const name = [contact.current.name?.givenName, contact.current.name?.familyName].filter(Boolean).join(" ")
          for (const c of contact.current.channels ?? []) list.push({ kind: "PERSON_CHANNEL", id: c.id, label: `${name}'s ${String(c.channelType).toLowerCase()}: ${c.valueDisplay}`, createdAt: c.createdAt })
        }
        setCandidates(list)
      })
      .catch(() => setCandidates([]))
  }, [base, pending.channels.length])

  const groups = useMemo(() => ACTIVITY_GROUPS, [])
  const visible = entries.filter((entry) => filter === "all" || entry.group === filter)

  const act = async (payload: Record<string, unknown>) => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`${base}/changes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      const body = await response.json().catch(() => null)
      if (!response.ok) return setMessage(body?.error ?? "The change could not be recorded.")
      await load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <Activity className="size-4 text-muted-foreground" /> Activity
        </h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Business changes to this company, with who made them and the evidence behind them</p>
      </div>
      <div className="p-4 flex flex-col gap-4">
        {state === "loading" && <p className="py-6 text-center text-xs text-muted-foreground">Loading activity...</p>}
        {state === "denied" && <p role="alert" className="py-6 text-center text-xs text-muted-foreground">You are not permitted to view this company&apos;s activity.</p>}
        {state === "unavailable" && <p role="status" className="py-6 text-center text-xs text-muted-foreground">{unavailable}</p>}
        {state === "error" && <p role="alert" className="py-6 text-center text-xs text-muted-foreground">Activity could not be loaded.</p>}
        {state === "ready" && (
          <>
            {message && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{message}</p>}

            {(pending.legalName.length > 0 || pending.channels.length > 0) && (
              <div className="flex flex-col gap-2" aria-label="Pending changes">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Awaiting action (not yet effective)</span>
                {pending.legalName.map((request) => (
                  <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
                    <span><b>Legal name change requested:</b> {request.previousLegalName} → {request.requestedLegalName}. The registered legal name is unchanged.</span>
                    <button type="button" onClick={() => setLegalOpen(true)} className="rounded-lg border border-border bg-background px-2.5 py-1 font-semibold hover:bg-muted">Review</button>
                  </div>
                ))}
                {pending.channels.map((request) => <ChannelPendingCard key={request.id} request={request} candidates={candidates} evidence={evidenceItems} base={base} busy={busy} onAct={act} />)}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => { setFilter(g.value); setLimit(20) }}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${filter === g.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No business changes have been recorded yet. Changes made from now on are listed here with who made them, when, and the evidence behind them.</p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {visible.slice(0, limit).map((entry) => (
                  <div key={entry.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="mt-1.5 size-1.5 rounded-full bg-primary/60 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{entry.label}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.summary}</p>
                        {(entry.previousValue || entry.newValue) && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {entry.previousValue ? <><span className="line-through">{entry.previousValue}</span> → </> : null}
                            {entry.newValue ? <span className="text-foreground">{entry.newValue}</span> : null}
                          </p>
                        )}
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          <time dateTime={entry.recordedAt} title={entry.recordedAt}>Recorded {new Date(entry.recordedAt).toISOString().replace("T", " ").slice(0, 16)} UTC</time>
                          {entry.actor ? ` by ${actorText(entry.actor)}` : ""}
                          {" · "}effective {entry.effectiveAt.slice(0, 10)}
                          {entry.registerEventId ? ` · register event ${entry.registerEventId.slice(0, 8)}` : ""}
                          {entry.requestSource ? ` · ${SOURCE_LABEL[entry.requestSource] ?? entry.requestSource}` : ""}
                          {entry.basis ? ` · basis: ${entry.basis.toLowerCase().replace(/_/g, " ")} (${entry.basisReference})` : ""}
                        </p>
                        {entry.evidence.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {entry.evidence.map((e) => (
                              access.evidence ? (
                                <a key={`${e.documentId}-${e.role}`} href={`${base}/evidence/${e.documentId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-primary hover:underline">
                                  <FileCheck2 className="size-3" /> {ROLE_LABEL[e.role] ?? e.role}{e.title ? `: ${e.title}` : ""}
                                </a>
                              ) : (
                                <span key={`${e.documentId}-${e.role}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
                                  <FileCheck2 className="size-3" /> {ROLE_LABEL[e.role] ?? e.role} (evidence access required to open)
                                </span>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">{relativeTime(entry.recordedAt)}</span>
                  </div>
                ))}
              </div>
            )}
            {visible.length > limit && (
              <button type="button" onClick={() => setLimit((n) => n + 20)} className="mx-auto rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted text-foreground shadow-2xs">
                Load more
              </button>
            )}
          </>
        )}
      </div>
      {legalOpen && <LegalNameChange companyId={companyId} currentName={companyName} canExecuteHint={access.execute} onClose={() => setLegalOpen(false)} onDone={() => { void load(); onChanged?.() }} />}
    </div>
  )
}

function ChannelPendingCard({ request, candidates, evidence, base, busy, onAct }: { request: ChannelPending; candidates: Candidate[]; evidence: EvidenceItem[]; base: string; busy: boolean; onAct: (payload: Record<string, unknown>) => Promise<void> }) {
  const [channel, setChannel] = useState("")
  const [method, setMethod] = useState("CALL_BACK")
  const [document, setDocument] = useState("")
  const [note, setNote] = useState("")
  const removal = request.changeKind === "REMOVE"
  const options = candidates.filter((c) => !request.requestedValue || (!c.label.toLowerCase().includes(request.requestedValue.toLowerCase()) && !(request.senderAddress && c.label.toLowerCase().includes(request.senderAddress.toLowerCase()))))
  // Only evidence the server will accept is offered: verified by a reviewer, securely stored, created after this request. (The server re-checks all of it.)
  const proofs = evidence.filter((e) => e.documentType === "CHANNEL_CHANGE_CONFIRMATION" && e.documentStatus === "verified" && e.payload.state === "stored" && e.payload.integrityVerified && Date.parse(e.createdAt) > Date.parse(request.recordedAt))
  const chosen = options.find((c) => `${c.kind}:${c.id}` === channel)
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
      <p>
        <b>{request.channelType.charAt(0) + request.channelType.slice(1).toLowerCase()} {removal ? "removal" : "change"} awaiting confirmation:</b> {removal ? `remove ${request.previousValue ?? "the current value"}` : `${request.previousValue ?? "none"} → ${request.requestedValue}`}. The current value stays in use until it is confirmed.
      </p>
      <p className="text-muted-foreground">Requested via {SOURCE_LABEL[request.requestSource] ?? request.requestSource.toLowerCase()} ({request.requestReference}){request.senderAddress ? `; sender ${request.senderAddress} (never trusted on its own)` : ""}.</p>
      {request.recordedByYou ? (
        <p role="note" className="mt-2 font-medium">You recorded this request, so a different authorized TES user must confirm it.</p>
      ) : (
        <div className="mt-2 grid gap-2">
          <select aria-label="Established channel used to confirm" value={channel} onChange={(e) => setChannel(e.target.value)} className="w-full min-w-0 max-w-full rounded-lg border border-border bg-background px-2 py-1.5">
            <option value="">Established channel the confirmation went through…</option>
            {options.map((c) => <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>{c.label}</option>)}
          </select>
          <select aria-label="Confirmation evidence" value={document} onChange={(e) => setDocument(e.target.value)} className="w-full min-w-0 max-w-full rounded-lg border border-border bg-background px-2 py-1.5">
            <option value="">{proofs.length ? "Verified confirmation evidence…" : "No verified confirmation evidence yet"}</option>
            {proofs.map((e) => <option key={e.documentId} value={e.documentId}>{e.documentTitle}</option>)}
          </select>
          {proofs.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              Confirmation needs evidence: upload the record of the call back or the reply from the established channel as a CHANNEL_CHANGE_CONFIRMATION document in the company&apos;s evidence (after this request was recorded) and have a reviewer verify it. Typing a reference does not confirm anything.
            </p>
          )}
          <select aria-label="Confirmation method" value={method} onChange={(e) => setMethod(e.target.value)} className="w-full min-w-0 max-w-full rounded-lg border border-border bg-background px-2 py-1.5">
            {[["CALL_BACK", "Call back"], ["EMAIL_REPLY", "Email reply"], ["IN_PERSON", "In person"], ["OTHER", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input aria-label="Note (not proof)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (not proof)" className="w-full min-w-0 max-w-full rounded-lg border border-border bg-background px-2 py-1.5" />
        </div>
      )}
      <div className="mt-2 flex gap-1.5">
        {!request.recordedByYou && (
          <button type="button" disabled={busy || !chosen || !document} onClick={() => chosen && void onAct({ action: "confirmChannelChange", requestId: request.id, confirmationChannelKind: chosen.kind, confirmationChannelId: chosen.id, confirmationMethod: method, confirmationEvidenceDocumentId: document, confirmationNote: note })} className="rounded-lg bg-primary px-2.5 py-1 font-semibold text-primary-foreground disabled:opacity-50">Confirm</button>
        )}
        <button type="button" disabled={busy} onClick={() => void onAct({ action: "closeChannelChange", requestId: request.id, outcome: "REJECTED", reason: "Rejected: not confirmed with verified evidence" })} className="rounded-lg border border-border px-2.5 py-1 font-semibold hover:bg-muted disabled:opacity-50">Reject</button>
        <a className="self-center text-[11px] text-primary hover:underline" href={`${base.replace(/\/api\/companies\//, "/companies/")}/onboarding`}>Evidence</a>
      </div>
    </div>
  )
}
