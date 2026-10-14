"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileCheck2, Loader2, Plus, ScanText, ShieldCheck, UploadCloud, X } from "lucide-react";
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable";
import { userMessage } from "@/lib/canonical-ui/unavailable";
import { unavailable } from "@/src/restored/business/adapter";
import { ALLOWED_MIME_TYPES, MAX_PAYLOAD_BYTES } from "@/lib/evidence-payload/definitions";

/**
 * Corporate Papers & Evidence, restored over the approved evidence lifecycle (upload -> quarantine -> scanner -> stored, secure
 * server-side view). Nothing is kept in the browser and no document bytes are read here: the file goes straight to the server
 * and a view is streamed back by it. The original's registry-request log, OCR and source-fact review have no approved canonical
 * operation: those controls keep their place and refuse with an explicit note (see adapter `unavailable`).
 *
 * Classification note: the evidence catalogue has no corporate-paper document types, so uploads are filed as OTHER_EVIDENCE and
 * this list shows that type. (A dedicated type needs a catalogue decision.)
 */

type Item = {
  documentId: string;
  documentType: string;
  documentTitle: string;
  documentStatus: "received" | "classified" | "verified" | "rejected" | "archived";
  createdAt: string;
  supersedesDocumentId: string | null;
  payload: {
    state: "quarantined" | "cleared" | "stored" | "blocked" | "superseded" | "archived";
    mimeType: string;
    byteSize: number;
    originalFilename: string;
    blockReason: string | null;
    integrityVerified: boolean;
    viewable: boolean;
    storedAt: string | null;
  };
};

const DOCUMENT_TYPE = "OTHER_EVIDENCE";
const KINDS = ["Formation / Articles", "Amendment", "Certificate / Status", "Registry Extract", "Ownership / Directors", "Other"];
const STATE_LABEL: Record<Item["payload"]["state"], string> = {
  quarantined: "In quarantine, awaiting security scan",
  cleared: "Scan cleared, promoting to evidence",
  stored: "Stored and hash-verified",
  blocked: "Blocked",
  superseded: "Superseded (retained)",
  archived: "Archived (retained)",
};
const FACT_FIELDS = ["Legal name", "Corporate number", "Incorporation date", "People, roles and ownership", "Amendment / filing summary"];

export function CorporateDocumentsSection({ companyId }: { companyId: string }) {
  const base = `/api/companies/${encodeURIComponent(companyId)}/evidence`;
  const [items, setItems] = useState<Item[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Unable to load corporate papers.");
    setItems((body.evidence as Item[]).filter((item) => item.documentType === DOCUMENT_TYPE));
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    load().catch((e) => !cancelled && setError(userMessage(e, "Unable to load corporate papers.")));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const records = items ?? [];
  const selected = records.find((r) => r.documentId === selectedId) || null;

  const selectFile = (recordId: string | null) => {
    uploadFor.current = recordId;
    fileInput.current?.click();
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError("Use a PDF, JPEG, PNG, HEIC or WebP document.");
      return;
    }
    if (file.size > MAX_PAYLOAD_BYTES) {
      setError(`The document exceeds the ${Math.floor(MAX_PAYLOAD_BYTES / 1024 / 1024)} MB limit.`);
      return;
    }
    setBusy("upload");
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("documentType", DOCUMENT_TYPE);
      form.set("documentTitle", file.name);
      // Attaching a replacement to a stored record supersedes it (the earlier document is kept); otherwise it is a new record.
      const target = records.find((r) => r.documentId === uploadFor.current);
      if (target && target.payload.state === "stored" && target.documentStatus !== "archived") form.set("supersedesDocumentId", target.documentId);
      const response = await fetch(base, { method: "POST", body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "The upload was refused.");
      await load();
      if (body?.documentId) setSelectedId(body.documentId);
    } catch (e) {
      setError(userMessage(e, "The document could not be uploaded."));
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const finalize = async (documentId: string) => {
    setBusy(`finalize-${documentId}`);
    setError("");
    try {
      const response = await fetch(`${base}/${encodeURIComponent(documentId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finalize" }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "The scan result could not be checked.");
      setItems((body.evidence as Item[]).filter((item) => item.documentType === DOCUMENT_TYPE));
    } catch (e) {
      setError(userMessage(e, "The scan result could not be checked."));
    } finally {
      setBusy("");
    }
  };

  const refuse = (error: Error) => setError(error.message);

  return (
    <section className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3.5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold"><FileCheck2 className="size-4 text-primary" /> Corporate Papers & Evidence</h2>
          <p className="text-[11px] text-muted-foreground">Formation, amendments, registry extracts, directors and ownership evidence. Facts remain tied to their source.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setRequestOpen(true)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Request from Registry</button>
          <button type="button" disabled={busy === "upload"} onClick={() => selectFile(null)} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
            {busy === "upload" ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />} Upload Document / OCR
          </button>
        </div>
      </div>
      <input ref={fileInput} type="file" accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      <p className="mx-5 mt-4 text-[11px] text-muted-foreground">
        Uploads go to a secure quarantine and become usable evidence only after the security scan clears them. Nothing is deleted; documents are superseded or archived. Documents are filed as general evidence (no corporate-paper document type exists in the evidence catalogue).
      </p>
      {error && <p role="alert" className="mx-5 mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,1fr)]">
        <div className="space-y-2">
          {items === null && !error && <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">Loading corporate papers...</p>}
          {items !== null && records.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">No corporate papers recorded yet.</p>}
          {records.map((r) => (
            <button key={r.documentId} type="button" onClick={() => setSelectedId(r.documentId)} className={`w-full rounded-xl border p-3 text-left text-xs hover:bg-muted/30 ${selectedId === r.documentId ? "border-primary" : "border-border"}`}>
              <div className="flex justify-between gap-3"><strong className="break-words">{r.documentTitle}</strong><span className="shrink-0 font-semibold text-primary">{r.documentStatus}</span></div>
              <div className="mt-1 text-muted-foreground">{r.payload.originalFilename} · {(r.payload.byteSize / 1024).toFixed(0)} KB</div>
              <div className="mt-1 text-muted-foreground">{STATE_LABEL[r.payload.state]}</div>
            </button>
          ))}
        </div>
        <div className="min-w-0 rounded-xl border border-border p-4">
          {!selected ? (
            <p className="text-xs text-muted-foreground">Select a record to inspect evidence, OCR candidates, verified facts and its activity.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold">{selected.documentTitle}</h3>
                  <p className="text-xs text-muted-foreground">{STATE_LABEL[selected.payload.state]} · {selected.documentStatus}</p>
                </div>
                <button type="button" onClick={() => setSelectedId(null)} aria-label="Close record"><X className="size-4" /></button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => selectFile(selected.documentId)} disabled={busy === "upload"} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Attach received document</button>
                {(selected.payload.state === "quarantined" || selected.payload.state === "cleared") && (
                  <button type="button" onClick={() => void finalize(selected.documentId)} disabled={busy === `finalize-${selected.documentId}`} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Check scan result</button>
                )}
                {selected.payload.viewable && (
                  <button type="button" onClick={() => refuse(unavailable.ocr())} className="flex items-center gap-1 rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-semibold text-primary"><ScanText className="size-3.5" /> Run OCR</button>
                )}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Attaching to a stored record files a replacement that supersedes it; the earlier document is kept.</p>
              {selected.payload.blockReason && <p className="mt-2 text-xs text-destructive">Blocked: {selected.payload.blockReason.replaceAll("_", " ").toLowerCase()}. Needs a staff decision; nothing was promoted.</p>}

              <div className="mt-4 space-y-3 border-t pt-4">
                <h4 className="text-xs font-bold">Record details</h4>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs">Document type<select disabled className="mt-1 w-full rounded-lg border bg-background p-2">{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
                  <label className="text-xs">Source<select disabled className="mt-1 w-full rounded-lg border bg-background p-2"><option>Client</option><option>Registry</option><option>Other</option></select></label>
                </div>
                {["Document title", "Registry / jurisdiction", "Registry reference", "Effective date / amendment date"].map((label, index) => (
                  <label key={label} className="block text-xs">{label}<input disabled readOnly value={index === 0 ? selected.documentTitle : ""} placeholder={index === 0 ? undefined : "Not recorded"} className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
                ))}
                <label className="block text-xs">Notes<textarea disabled placeholder="Not recorded" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
                <button type="button" onClick={() => refuse(unavailable.recordDetails())} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Save record details</button>
              </div>

              <div className="mt-4 border-t pt-4">
                <h4 className="text-xs font-bold">Evidence</h4>
                {selected.payload.viewable ? (
                  <div className="mt-2 h-72 overflow-hidden rounded-lg border">
                    <iframe title={`Evidence: ${selected.documentTitle}`} src={`${base}/${encodeURIComponent(selected.documentId)}`} className="size-full bg-white" />
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">The document can be viewed once it is stored and hash-verified. Current state: {STATE_LABEL[selected.payload.state].toLowerCase()}.</p>
                )}
                <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                  {selected.payload.integrityVerified ? <><ShieldCheck className="size-3" /> Integrity verified. Views are authorized and recorded by the server.</> : "Integrity not yet verified."}
                </p>
              </div>

              {selected.payload.viewable && (
                <div className="mt-4 space-y-3 border-t pt-4">
                  <h4 className="text-xs font-bold">Review source facts</h4>
                  <p className="text-[11px] text-muted-foreground">OCR suggestions require review. Directors and ownership are advisory until separately entered and linked to evidence.</p>
                  {FACT_FIELDS.map((label) => (
                    <label key={label} className="block text-xs font-medium">{label}<input disabled placeholder="Not recorded" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
                  ))}
                  <button type="button" onClick={() => refuse(unavailable.reviewedFacts())} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Confirm reviewed facts</button>
                  <CanonicalUnavailable action="Source-fact review" reason="no canonical record holds reviewed corporate facts, so none can be confirmed or saved." />
                </div>
              )}

              <details className="mt-4 border-t pt-3 text-xs">
                <summary className="font-semibold">Activity (1)</summary>
                <div className="mt-2 space-y-2">
                  <p>{new Date(selected.createdAt).toLocaleString()} · UPLOADED: {selected.payload.originalFilename}</p>
                  <p className="text-muted-foreground">Per-document activity is not readable here yet; only the upload is shown.</p>
                </div>
              </details>
            </>
          )}
        </div>
      </div>
      {requestOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRequestOpen(false);
              refuse(unavailable.registryRequest());
            }}
            className="w-full max-w-lg space-y-3 rounded-2xl bg-card p-6 shadow-2xl"
          >
            <div className="flex justify-between"><h3 className="text-sm font-bold">Record a Registry Request</h3><button type="button" onClick={() => setRequestOpen(false)}><X className="size-4" /></button></div>
            <p className="text-xs text-muted-foreground">This tracks the request. It does not send it to the registry automatically.</p>
            <CanonicalUnavailable action="Recording a registry request" reason="no canonical record tracks registry requests, so submitting will not save anything." />
            <label className="block text-xs">Document type<select name="kind" className="mt-1 w-full rounded-lg border bg-background p-2">{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="block text-xs">Title<input name="title" required className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
            <label className="block text-xs">Registry / jurisdiction<input name="registry" required className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
            <label className="block text-xs">Request reference<input name="reference" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
            <label className="block text-xs">Notes<textarea name="notes" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
            <button type="submit" className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"><Plus className="size-3.5" /> Record request</button>
          </form>
        </div>
      )}
    </section>
  );
}
