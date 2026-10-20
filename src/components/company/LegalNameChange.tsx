"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { FileCheck2, ShieldAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Contact = { person: { id: string }; relationship: { id: string; effectiveTo: string | null }; current: { name: { givenName: string | null; familyName: string | null } | null; purposes: Array<{ purpose: string; isPrimary: boolean }> } }
type EvidenceItem = { documentId: string; documentType: string; documentTitle: string; documentStatus: string; payload: { state: string; integrityVerified: boolean } }
type LegalRequest = {
  id: string; status: string; previousLegalName: string; requestedLegalName: string; requesterBasis: "CUSTOMER_AUTHORITY" | "VERIFIED_DIRECTOR"; requestedByPersonId: string
  requestSource: string; requestReference: string; governmentEvidenceDocumentId: string | null; writtenRequestEvidenceDocumentId: string | null; directorEvidenceDocumentId: string | null
}
type Blocker = { code: string; message: string }

const ROLES = [
  { role: "GOVERNMENT_DOCUMENT", type: "GOVERNMENT_NAME_DOCUMENT", label: "Government-issued document establishing the new legal name", field: "governmentEvidenceDocumentId" },
  { role: "WRITTEN_REQUEST", type: "COMPANY_WRITTEN_REQUEST", label: "The company's written request", field: "writtenRequestEvidenceDocumentId" },
  { role: "DIRECTOR_VERIFICATION", type: "DIRECTOR_VERIFICATION_DOCUMENT", label: "Document evidencing the Director's authority", field: "directorEvidenceDocumentId" },
] as const

const nameOf = (c: Contact) => [c.current.name?.givenName, c.current.name?.familyName].filter(Boolean).join(" ") || "Unnamed contact"

/**
 * The registered legal-name change. It records a REQUEST (the legal name does not change), links the government document and the company's
 * written request from the company's evidence, and lets an authorized Onboarding Team member or the founder-level account EXECUTE it. The
 * server enforces every rule; this panel only shows what the server reports is still missing.
 */
export function LegalNameChange({ companyId, currentName, canExecuteHint, onClose, onDone }: { companyId: string; currentName: string; canExecuteHint?: boolean; onClose: () => void; onDone: () => void }) {
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const [contacts, setContacts] = useState<Contact[]>([])
  const [evidence, setEvidence] = useState<EvidenceItem[]>([])
  const [pending, setPending] = useState<LegalRequest | null>(null)
  const [blockers, setBlockers] = useState<Blocker[]>([])
  const [canExecute, setCanExecute] = useState(!!canExecuteHint)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [holders, setHolders] = useState<{ restricted: boolean; holders: Array<{ personId: string; authorityTypes: string[] }> }>({ restricted: false, holders: [] })
  const [form, setForm] = useState({ name: "", requesterId: "", basis: "CUSTOMER_AUTHORITY", source: "EMAIL", reference: "", received: new Date().toISOString().slice(0, 10) })
  const [effective, setEffective] = useState("")

  const load = useCallback(async () => {
    const [c, e, a] = await Promise.all([
      fetch(`${base}/contacts`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${base}/evidence`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${base}/changes`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    setContacts(((c?.contacts ?? []) as Contact[]).filter((contact) => contact.relationship.effectiveTo === null))
    const h = await fetch(`${base}/changes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "legalNameRequesters" }) }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    setHolders(h ?? { restricted: true, holders: [] })
    setEvidence((e?.evidence ?? []) as EvidenceItem[])
    const open = (a?.pending?.legalName ?? [])[0] as LegalRequest | undefined
    setPending(open ?? null)
    setCanExecute(!!a?.access?.execute)
    if (open) {
      const ready = await fetch(`${base}/changes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "legalNameReadiness", requestId: open.id }) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
      setBlockers(ready?.blockers ?? [])
    } else setBlockers([])
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  const post = async (payload: Record<string, unknown>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`${base}/changes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(body?.error ?? "The change could not be recorded.")
        if (Array.isArray(body?.blockers)) setBlockers(body.blockers)
        return false
      }
      await load()
      return true
    } finally {
      setBusy(false)
    }
  }

  const requester = useMemo(() => contacts.find((c) => c.person.id === form.requesterId), [contacts, form.requesterId])
  const AUTHORITY_LABEL: Record<string, string> = { SERVICE_DECISION_AUTHORITY: "Service Decision Authority", CONTRACT_SIGNATORY: "Contract Signatory" }
  const authorityOf = (personId: string) => holders.holders.find((h) => h.personId === personId)?.authorityTypes.map((t) => AUTHORITY_LABEL[t] ?? t).join(" and ") ?? null
  // The server decides who is authorized; the page only shows what it reports. A Primary Contact designation is NOT an authority.
  const requesterAuthority = requester ? authorityOf(requester.person.id) : null
  const optionsFor = (type: string) => evidence.filter((item) => item.documentType === type)

  const submitRequest = async () => {
    if (!requester) return setError("Choose who made the request.")
    const ok = await post({
      action: "requestLegalNameChange", requestedLegalName: form.name.trim(), requestedByPersonId: requester.person.id, requesterRelationshipId: requester.relationship.id,
      requesterBasis: form.basis, requestSource: form.source, requestReference: form.reference, requestReceivedAt: new Date(`${form.received}T00:00:00Z`).toISOString(),
    })
    if (ok) setForm({ ...form, name: "", reference: "" })
  }

  const evidenceLabel = (id: string | null) => {
    const item = evidence.find((e) => e.documentId === id)
    return item ? `${item.documentTitle} (${item.documentStatus}${item.payload.state !== "stored" ? `, ${item.payload.state}` : ""})` : null
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-label="Change registered legal name">
      <div className="w-full max-w-2xl space-y-4 rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start justify-between border-b border-border pb-3">
          <div>
            <h3 className="text-base font-bold">Change registered legal name</h3>
            <p className="text-xs text-muted-foreground">Current legal name: <span className="font-semibold text-foreground">{currentName}</span>. It changes only after the evidence below is linked and an authorized TES user executes the change.</p>
          </div>
          <button type="button" onClick={() => { onDone(); onClose() }} aria-label="Close" className="rounded-lg p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
        </div>

        {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</div>}

        {!pending ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="ln-name" className="text-xs text-muted-foreground">New registered legal name</Label>
              <Input id="ln-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Exactly as on the government document" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ln-basis" className="text-xs text-muted-foreground">Requester&apos;s authority</Label>
              <select id="ln-basis" value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value, requesterId: "" })} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                <option value="CUSTOMER_AUTHORITY">Service Decision Authority or Contract Signatory</option>
                <option value="VERIFIED_DIRECTOR">Director (verified authority document)</option>
              </select>
              <p className="text-[11px] text-muted-foreground">A Primary Contact designation does not authorize a legal-name change.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ln-requester" className="text-xs text-muted-foreground">Requested by</Label>
              <select id="ln-requester" value={form.requesterId} onChange={(e) => setForm({ ...form, requesterId: e.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                <option value="">Choose a current contact</option>
                {contacts
                  .filter((c) => form.basis !== "CUSTOMER_AUTHORITY" || holders.restricted || authorityOf(c.person.id))
                  .map((c) => (
                    <option key={c.person.id} value={c.person.id}>{nameOf(c)}{authorityOf(c.person.id) ? ` (${authorityOf(c.person.id)})` : ""}</option>
                  ))}
              </select>
              {form.basis === "CUSTOMER_AUTHORITY" && holders.restricted && <p className="text-[11px] text-amber-600">You cannot read the contract authority records, so the server will check this person&apos;s authority and refuse the request if they hold none.</p>}
              {form.basis === "CUSTOMER_AUTHORITY" && !holders.restricted && holders.holders.length === 0 && <p role="alert" className="text-[11px] text-amber-600">No contact currently holds a Service Decision Authority or Contract Signatory role for this company. Record one in the contract authority process, or use a Director with a verified document.</p>}
              {form.basis === "VERIFIED_DIRECTOR" && requester && <p className="text-[11px] text-amber-600">A Director&apos;s title alone is not proof: a verified document evidencing their authority must be linked before the change can be executed.</p>}
              {requester && form.basis === "CUSTOMER_AUTHORITY" && !requesterAuthority && !holders.restricted && <p role="alert" className="text-[11px] text-destructive">This person holds no customer authority.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ln-source" className="text-xs text-muted-foreground">Request received by</Label>
              <select id="ln-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                {["EMAIL", "LETTER", "PORTAL", "OTHER"].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ln-ref" className="text-xs text-muted-foreground">Reference to the written request</Label>
              <Input id="ln-ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. email of 2026-10-19, subject: legal name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ln-received" className="text-xs text-muted-foreground">Date received</Label>
              <Input id="ln-received" type="date" value={form.received} onChange={(e) => setForm({ ...form, received: e.target.value })} />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="button" onClick={() => void submitRequest()} disabled={busy || !form.name.trim() || !form.requesterId || form.reference.trim().length < 3}>Record request</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <p className="font-semibold">Pending request: {pending.previousLegalName} → {pending.requestedLegalName}</p>
              <p className="text-muted-foreground">Requested by {nameOf(contacts.find((c) => c.person.id === pending.requestedByPersonId) ?? ({ current: { name: null, purposes: [] } } as unknown as Contact))} as {pending.requesterBasis === "CUSTOMER_AUTHORITY" ? "a Service Decision Authority / Contract Signatory" : "a Director (evidenced)"} · {pending.requestSource.toLowerCase()} · {pending.requestReference}. The registered legal name is unchanged until this is executed.</p>
            </div>

            {ROLES.filter((r) => r.role !== "DIRECTOR_VERIFICATION" || pending.requesterBasis === "VERIFIED_DIRECTOR").map((r) => {
              const linked = pending[r.field as keyof LegalRequest] as string | null
              return (
                <div key={r.role} className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileCheck2 className="size-3.5" />{r.label}</Label>
                  <select
                    aria-label={r.label}
                    value={linked ?? ""}
                    disabled={busy}
                    onChange={(e) => e.target.value && void post({ action: "attachLegalNameEvidence", requestId: pending.id, role: r.role, documentId: e.target.value })}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">{optionsFor(r.type).length ? "Choose an uploaded document" : "No document of this type uploaded yet"}</option>
                    {optionsFor(r.type).map((item) => <option key={item.documentId} value={item.documentId}>{item.documentTitle} — {item.documentStatus}{item.payload.state !== "stored" ? `, ${item.payload.state}` : ""}</option>)}
                  </select>
                  {linked && <p className="text-[11px] text-muted-foreground">Linked: {evidenceLabel(linked) ?? linked}. <a className="text-primary hover:underline" target="_blank" rel="noreferrer" href={`${base}/evidence/${linked}`}>View</a></p>}
                </div>
              )
            })}
            <p className="text-[11px] text-muted-foreground">Upload documents (types: GOVERNMENT_NAME_DOCUMENT, COMPANY_WRITTEN_REQUEST, DIRECTOR_VERIFICATION_DOCUMENT) in <a className="text-primary hover:underline" href={`/companies/${companyId}/onboarding`}>Onboarding evidence</a>; a reviewer must verify them before the change can be executed.</p>

            {blockers.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-50/60 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300" aria-label="What is still missing">
                {blockers.map((b) => <li key={b.code} className="flex items-start gap-1.5"><ShieldAlert className="mt-0.5 size-3.5 shrink-0" />{b.message}</li>)}
              </ul>
            )}

            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void post({ action: "closeLegalNameRequest", requestId: pending.id, outcome: "WITHDRAWN", reason: "Withdrawn from Company Edit" })}>Withdraw request</Button>
              {canExecute ? (
                <div className="flex items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ln-effective" className="text-xs text-muted-foreground">Effective date (from the document)</Label>
                    <Input id="ln-effective" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
                  </div>
                  <Button type="button" disabled={busy || !effective || blockers.length > 0} onClick={async () => { if (await post({ action: "applyLegalNameChange", requestId: pending.id, effectiveDate: effective })) { onDone(); onClose() } }}>Execute change</Button>
                </div>
              ) : (
                <p className="max-w-xs text-right text-[11px] text-muted-foreground">Only an authorized Onboarding Team member or the founder-level account can execute this change.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
