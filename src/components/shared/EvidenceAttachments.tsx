"use client"

import React, { useCallback, useEffect, useState } from "react"
import { Archive, ExternalLink, FileCheck2, Loader2, Paperclip, Plus } from "lucide-react"

import { EVIDENCE_LINK_TARGETS, type EvidenceLinkTargetTable } from "@/lib/evidence-payload/definitions"
import type { EvidenceItemView, EvidenceLinkView } from "@/lib/evidence-payload/types"

/**
 * Evidence attachments for ONE canonical record: the documents of the SAME company that are attached to it.
 *
 * Reusable by any workspace whose record kind is in EVIDENCE_LINK_TARGETS. It is a thin client of the existing canonical evidence API
 * (`/api/companies/{companyId}/evidence`, Evidence Phase 1): it never uploads, never reads storage, never holds a bucket, object name or
 * URL, and keeps nothing in the browser. The company comes from the page URL (the `companyId` prop the workspace already uses for its own
 * calls) and the server derives and enforces everything else: capabilities, the company boundary and document eligibility.
 *
 * Vocabulary (the domain's own): a document's review status is received / classified / verified / rejected / archived, set by evidence
 * REVIEW only. "Attached" describes the association and nothing else: attaching never verifies a document and never shows the record is
 * compliant, and the component says so.
 */

type Permissions = { canAssociate: boolean; canArchive: boolean }
type LoadState = "loading" | "ready" | "forbidden" | "error"

export const DOCUMENT_STATUS_LABEL: Record<EvidenceItemView["documentStatus"], { label: string; tone: string }> = {
  received: { label: "Received (not reviewed)", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  classified: { label: "Classified (not verified)", tone: "bg-sky-50 text-sky-800 border-sky-200" },
  verified: { label: "Verified by review", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  rejected: { label: "Rejected", tone: "bg-red-50 text-red-800 border-red-200" },
  archived: { label: "Document archived", tone: "bg-amber-50 text-amber-800 border-amber-200" },
}

const PAYLOAD_NOTE: Partial<Record<EvidenceLinkView["document"]["payloadState"], string>> = {
  superseded: "Superseded by a newer version (retained)",
  archived: "Archived (retained)",
  blocked: "Blocked",
}

const eligible = (item: EvidenceItemView) => item.payload.state === "stored" && item.documentStatus !== "archived" && item.documentStatus !== "rejected"

async function readJson(response: Response): Promise<{ ok: boolean; status: number; body: Record<string, any> | null }> {
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) }
}

function failureMessage(status: number, body: Record<string, any> | null, fallback: string): string {
  if (status === 403) return "You are not permitted to do that."
  if (status === 404) return "That document or record was not found for this company."
  return typeof body?.error === "string" && status < 500 ? body.error : fallback
}

export function EvidenceAttachments({
  companyId,
  targetTable,
  targetId,
  targetLabel = "record",
  allowWrite = true,
  compact = false,
}: {
  companyId: string
  targetTable: EvidenceLinkTargetTable
  targetId: string
  /** Lower-case noun for messages, for example "policy". */
  targetLabel?: string
  /** False when the workspace knows the record is closed (for example archived): history stays readable, writes are hidden. */
  allowWrite?: boolean
  compact?: boolean
}) {
  const base = `/api/companies/${encodeURIComponent(companyId)}/evidence`
  const [state, setState] = useState<LoadState>("loading")
  const [links, setLinks] = useState<EvidenceLinkView[]>([])
  const [permissions, setPermissions] = useState<Permissions>({ canAssociate: false, canArchive: false })
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null)
  const [picker, setPicker] = useState<{ loading: boolean; items: EvidenceItemView[]; error: string | null } | null>(null)
  const [selected, setSelected] = useState("")
  const [busy, setBusy] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ targetTable, targetId, includeArchived: "true" })
      const result = await readJson(await fetch(`${base}?${query}`, { cache: "no-store" }))
      if (result.status === 403) return setState("forbidden")
      if (!result.ok || !result.body) return setState("error")
      setLinks(result.body.links as EvidenceLinkView[])
      setPermissions(result.body.permissions as Permissions)
      setState("ready")
    } catch {
      setState("error")
    }
  }, [base, targetId, targetTable])

  useEffect(() => {
    setState("loading")
    void load()
  }, [load])

  const active = links.filter((link) => link.status === "active")
  const archived = links.filter((link) => link.status === "archived")
  const canWrite = allowWrite && permissions.canAssociate

  async function openPicker() {
    setNotice(null)
    setSelected("")
    setPicker({ loading: true, items: [], error: null })
    try {
      const result = await readJson(await fetch(base, { cache: "no-store" }))
      if (!result.ok || !result.body) return setPicker({ loading: false, items: [], error: failureMessage(result.status, result.body, "The company's documents could not be loaded.") })
      setPicker({ loading: false, items: result.body.evidence as EvidenceItemView[], error: null })
    } catch {
      setPicker({ loading: false, items: [], error: "The company's documents could not be loaded." })
    }
  }

  async function patch(documentId: string, body: Record<string, unknown>) {
    return readJson(await fetch(`${base}/${encodeURIComponent(documentId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))
  }

  async function attach() {
    if (!selected) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await patch(selected, { action: "link", targetTable, targetId })
      if (!result.ok) {
        setNotice({ kind: "error", text: failureMessage(result.status, result.body, "The document could not be attached.") })
        return
      }
      setNotice({ kind: "ok", text: result.body?.created === false ? "That document was already attached." : "Document attached. Attaching does not verify it." })
      setPicker(null)
      await load()
    } catch {
      setNotice({ kind: "error", text: "The document could not be attached." })
    } finally {
      setBusy(false)
    }
  }

  async function archive(link: EvidenceLinkView) {
    setBusy(true)
    setNotice(null)
    try {
      const result = await patch(link.documentId, { action: "archiveLink", linkId: link.linkId })
      if (!result.ok) {
        setNotice({ kind: "error", text: failureMessage(result.status, result.body, "The association could not be archived.") })
        return
      }
      setNotice({ kind: "ok", text: "Association archived. The document itself is unchanged." })
      setConfirmArchive(null)
      await load()
    } catch {
      setNotice({ kind: "error", text: "The association could not be archived." })
    } finally {
      setBusy(false)
    }
  }

  const attachedIds = new Set(active.map((link) => link.documentId))
  const choices = (picker?.items ?? []).filter((item) => eligible(item) && !attachedIds.has(item.documentId))
  const noun = EVIDENCE_LINK_TARGETS[targetTable]?.label.toLowerCase() ?? targetLabel

  return (
    <div className={`mt-2 rounded-xl border border-border/80 bg-background ${compact ? "p-2" : "p-2.5"} text-xs`} data-testid="evidence-attachments">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 text-muted-foreground">
          <FileCheck2 className="size-4 shrink-0" />
          <span className="font-semibold truncate">Evidence{state === "ready" ? ` (${active.length} attached)` : ""}</span>
        </div>
        {state === "ready" && canWrite && !picker ? (
          <button type="button" onClick={() => void openPicker()} className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline shrink-0">
            <Paperclip className="size-3.5" /> Attach existing document
          </button>
        ) : null}
      </div>

      {state === "loading" ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading evidence…</div>
      ) : null}
      {state === "forbidden" ? <div className="mt-1.5 text-amber-800" role="status">You are not permitted to view this company's evidence.</div> : null}
      {state === "error" ? (
        <div className="mt-1.5 text-red-800" role="alert">
          Evidence could not be loaded.{" "}
          <button type="button" className="font-semibold underline" onClick={() => { setState("loading"); void load() }}>Try again</button>
        </div>
      ) : null}

      {state === "ready" ? (
        <>
          {active.length === 0 ? (
            <div className="mt-1.5 text-muted-foreground">No document is attached to this {noun}.</div>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {active.map((link) => (
                <AttachmentRow
                  key={link.linkId}
                  link={link}
                  companyId={companyId}
                  canArchive={allowWrite && permissions.canArchive}
                  confirming={confirmArchive === link.linkId}
                  busy={busy}
                  onAskArchive={() => setConfirmArchive(link.linkId)}
                  onCancelArchive={() => setConfirmArchive(null)}
                  onArchive={() => void archive(link)}
                />
              ))}
            </ul>
          )}
          {archived.length > 0 ? (
            <div className="mt-1.5">
              <button type="button" className="text-[11px] font-semibold text-muted-foreground underline" onClick={() => setShowArchived((value) => !value)}>
                {showArchived ? "Hide" : "Show"} archived associations ({archived.length})
              </button>
              {showArchived ? (
                <ul className="mt-1 space-y-1">
                  {archived.map((link) => (
                    <AttachmentRow key={link.linkId} link={link} companyId={companyId} canArchive={false} confirming={false} busy={false} onAskArchive={() => undefined} onCancelArchive={() => undefined} onArchive={() => undefined} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {!permissions.canAssociate && state === "ready" ? <div className="mt-1.5 text-[11px] text-muted-foreground">Read-only: you can view attached evidence but not change it.</div> : null}
          <p className="mt-1.5 text-[10px] text-muted-foreground">Attaching a document does not verify it or show that this {noun} is compliant. Only a completed review verifies a document.</p>
        </>
      ) : null}

      {picker ? (
        <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2" data-testid="evidence-picker">
          <div className="mb-1 font-semibold">Attach an existing document of this company</div>
          {picker.loading ? <div className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading documents…</div> : null}
          {picker.error ? <div className="text-red-800" role="alert">{picker.error}</div> : null}
          {!picker.loading && !picker.error && choices.length === 0 ? (
            <div className="text-muted-foreground">No eligible document. Only stored, scanner-cleared documents that are not archived or rejected, and not already attached here, can be attached.</div>
          ) : null}
          {choices.length > 0 ? (
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={selected} onChange={(event) => setSelected(event.target.value)} aria-label="Document to attach">
              <option value="">Select a document…</option>
              {choices.map((item) => (
                <option key={item.documentId} value={item.documentId}>
                  {item.documentTitle} · {item.documentType} · {DOCUMENT_STATUS_LABEL[item.documentStatus].label}
                </option>
              ))}
            </select>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <button type="button" disabled={!selected || busy} onClick={() => void attach()} className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-50">
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Attach
            </button>
            <button type="button" disabled={busy} onClick={() => setPicker(null)} className="rounded-lg border px-2.5 py-1 text-[11px] font-semibold">Cancel</button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className={`mt-1.5 ${notice.kind === "error" ? "text-red-800" : "text-emerald-800"}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</div>
      ) : null}
    </div>
  )
}

function AttachmentRow({
  link,
  companyId,
  canArchive,
  confirming,
  busy,
  onAskArchive,
  onCancelArchive,
  onArchive,
}: {
  link: EvidenceLinkView
  companyId: string
  canArchive: boolean
  confirming: boolean
  busy: boolean
  onAskArchive: () => void
  onCancelArchive: () => void
  onArchive: () => void
}) {
  const status = DOCUMENT_STATUS_LABEL[link.document.documentStatus]
  const payloadNote = PAYLOAD_NOTE[link.document.payloadState]
  const isActive = link.status === "active"
  return (
    <li className="rounded-lg border border-border/70 p-2" data-testid="evidence-association" data-association-status={link.status}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-foreground truncate">{link.document.documentTitle}</span>
        <span className="text-muted-foreground">{link.document.documentType}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${isActive ? "bg-primary/10 text-primary border-primary/20" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
          {isActive ? "Attached" : "Association archived"}
        </span>
        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${status.tone}`}>{status.label}</span>
        {payloadNote ? <span className="text-[10px] text-muted-foreground">{payloadNote}</span> : null}
        <span className="text-[10px] text-muted-foreground">
          {link.relationshipType === "source" ? "Source" : "Supports"} · attached {link.createdAt.slice(0, 10)}
          {link.archivedAt ? ` · archived ${link.archivedAt.slice(0, 10)}` : ""}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <a className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline" href={`/api/companies/${encodeURIComponent(companyId)}/evidence/${encodeURIComponent(link.documentId)}`} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-3" /> Open document
        </a>
        {isActive && canArchive && !confirming ? (
          <button type="button" onClick={onAskArchive} className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:underline">
            <Archive className="size-3" /> Archive association
          </button>
        ) : null}
        {confirming ? (
          <span className="inline-flex items-center gap-2 text-[11px]">
            Archive this association? The document is not archived or deleted.
            <button type="button" disabled={busy} onClick={onArchive} className="font-bold text-primary hover:underline">Archive</button>
            <button type="button" disabled={busy} onClick={onCancelArchive} className="font-semibold hover:underline">Keep</button>
          </span>
        ) : null}
      </div>
    </li>
  )
}
