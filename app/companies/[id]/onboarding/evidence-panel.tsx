"use client"

import { useCallback, useEffect, useState } from "react"
import { FileCheck2, Loader2, ShieldCheck, Upload } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ALLOWED_MIME_TYPES, KNOWN_DOCUMENT_TYPES, MAX_PAYLOAD_BYTES, REQUIREMENT_CATALOGUE } from "@/lib/evidence-payload/definitions"

type Item = {
  documentId: string
  documentType: string
  documentTitle: string
  documentStatus: "received" | "classified" | "verified" | "rejected" | "archived"
  expiresAt: string | null
  createdAt: string
  supersedesDocumentId: string | null
  payload: {
    state: "quarantined" | "cleared" | "stored" | "blocked" | "superseded" | "archived"
    mimeType: string
    byteSize: number
    originalFilename: string
    blockReason: string | null
    integrityVerified: boolean
    viewable: boolean
    storedAt: string | null
  }
}

const STATE_LABEL: Record<Item["payload"]["state"], string> = {
  quarantined: "In quarantine — awaiting security scan",
  cleared: "Scan cleared — promoting to evidence",
  stored: "Stored and hash-verified",
  blocked: "Blocked",
  superseded: "Superseded (retained)",
  archived: "Archived (retained)",
}

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm"

/**
 * Evidence documents: upload -> quarantine -> scanner -> evidence, secure view, review and requirement linking.
 * The browser only ever talks to /api/companies/{id}/evidence: it sends bytes to the server and receives bytes from the
 * server. It never sees a bucket, an object name, a generation or a URL, and it keeps nothing in browser storage.
 */
export default function EvidencePanel({ companyId }: { companyId: string }) {
  const base = `/api/companies/${encodeURIComponent(companyId)}/evidence`
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [documentType, setDocumentType] = useState("CUSTOMER_AUTHORITY_NOTICE")
  const [title, setTitle] = useState("")
  const [supersedes, setSupersedes] = useState("")

  const load = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? "Unable to load evidence.")
    setItems(body.evidence)
  }, [base])

  useEffect(() => {
    let cancelled = false
    load().catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Unable to load evidence."))
    return () => {
      cancelled = true
    }
  }, [load])

  async function patch(name: string, documentId: string, payload: Record<string, unknown>) {
    setBusy(name)
    setError("")
    try {
      const response = await fetch(`${base}/${encodeURIComponent(documentId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? "The change was refused.")
      setItems(body.evidence)
    } catch (err) {
      setError(err instanceof Error ? err.message : "The change was refused.")
    } finally {
      setBusy("")
    }
  }

  async function upload() {
    if (!file) return
    setBusy("upload")
    setError("")
    try {
      const form = new FormData()
      form.set("file", file)
      form.set("documentType", documentType)
      form.set("documentTitle", title || file.name)
      if (supersedes) form.set("supersedesDocumentId", supersedes)
      const response = await fetch(base, { method: "POST", body: form })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? "The upload was refused.")
      setFile(null)
      setTitle("")
      setSupersedes("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload was refused.")
    } finally {
      setBusy("")
    }
  }

  if (!items) return <div className="p-6 text-center text-sm text-muted-foreground">{error || "Loading evidence..."}</div>

  const replaceable = items.filter((item) => item.documentType === documentType && item.payload.state === "stored" && item.documentStatus !== "archived")

  return (
    <Card>
      <CardHeader className="border-b bg-muted/30 py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileCheck2 className="size-4" />
          Evidence documents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">
            Uploads go to a secure quarantine. A document becomes usable evidence only after the security scan clears it and its integrity hash is verified. Nothing is ever deleted — documents are
            archived or superseded.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">File (PDF or image, up to {Math.floor(MAX_PAYLOAD_BYTES / 1024 / 1024)} MB)</Label>
              <Input type="file" accept={ALLOWED_MIME_TYPES.join(",")} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Document type</Label>
              <select className={selectClass} value={documentType} onChange={(event) => { setDocumentType(event.target.value); setSupersedes("") }}>
                {KNOWN_DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Signed authority notice, March" />
            </div>
          </div>
          {replaceable.length > 0 ? (
            <div className="space-y-1">
              <Label className="text-xs">Replaces (the earlier document is archived once this one is stored)</Label>
              <select className={selectClass} value={supersedes} onChange={(event) => setSupersedes(event.target.value)}>
                <option value="">Does not replace a document</option>
                {replaceable.map((item) => (
                  <option key={item.documentId} value={item.documentId}>
                    {item.documentTitle}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Button size="sm" disabled={!file || busy === "upload"} onClick={upload}>
            {busy === "upload" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Upload to quarantine
          </Button>
        </div>

        <div className="divide-y rounded-lg border">
          {items.length === 0 ? <div className="p-4 text-sm text-muted-foreground">No evidence uploaded yet.</div> : null}
          {items.map((item) => {
            const open = item.payload.state === "quarantined" || item.payload.state === "cleared"
            return (
              <div key={item.documentId} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{item.documentTitle}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.documentType} · {item.payload.originalFilename} · {(item.payload.byteSize / 1024).toFixed(0)} KB
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={item.payload.state === "blocked" ? "destructive" : item.payload.state === "stored" ? "default" : "outline"}>{STATE_LABEL[item.payload.state]}</Badge>
                    <Badge variant={item.documentStatus === "verified" ? "default" : "outline"}>{item.documentStatus}</Badge>
                    {item.payload.integrityVerified ? (
                      <Badge variant="outline" className="gap-1">
                        <ShieldCheck className="size-3" /> integrity verified
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {item.payload.blockReason ? <div className="text-xs text-destructive">Blocked: {item.payload.blockReason.replaceAll("_", " ").toLowerCase()}. Needs a staff decision; nothing was promoted.</div> : null}
                <div className="flex flex-wrap gap-2">
                  {open ? (
                    <Button size="sm" variant="outline" disabled={busy === `finalize-${item.documentId}`} onClick={() => patch(`finalize-${item.documentId}`, item.documentId, { action: "finalize" })}>
                      Check scan result
                    </Button>
                  ) : null}
                  {item.payload.viewable ? (
                    <a
                      className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent/60"
                      href={`${base}/${encodeURIComponent(item.documentId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View (logged)
                    </a>
                  ) : null}
                  {item.payload.state === "stored" && ["received", "classified"].includes(item.documentStatus) ? (
                    <Button size="sm" variant="outline" disabled={busy === `verify-${item.documentId}`} onClick={() => patch(`verify-${item.documentId}`, item.documentId, { action: "review", decision: "verified" })}>
                      Mark verified
                    </Button>
                  ) : null}
                  {item.payload.state === "stored" && REQUIREMENT_CATALOGUE[item.documentType] && !["archived", "rejected"].includes(item.documentStatus) ? (
                    <Button size="sm" variant="outline" disabled={busy === `link-${item.documentId}`} onClick={() => patch(`link-${item.documentId}`, item.documentId, { action: "satisfyRequirement" })}>
                      Satisfy requirement
                    </Button>
                  ) : null}
                  {open ? (
                    <Button size="sm" variant="ghost" disabled={busy === `block-${item.documentId}`} onClick={() => patch(`block-${item.documentId}`, item.documentId, { action: "block" })}>
                      Block
                    </Button>
                  ) : null}
                  {item.payload.state !== "archived" ? (
                    <Button size="sm" variant="ghost" disabled={busy === `archive-${item.documentId}`} onClick={() => patch(`archive-${item.documentId}`, item.documentId, { action: "archive" })}>
                      Archive
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
