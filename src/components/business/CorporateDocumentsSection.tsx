"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileCheck2, Plus, ScanText, UploadCloud, X } from "lucide-react";
import { getEvidencePayload, putEvidencePayload } from "@/lib/evidence-payload-store";
import { recordAuditEvent } from "@/lib/audit-logger";
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer";

type Kind = "Formation / Articles" | "Amendment" | "Certificate / Status" | "Registry Extract" | "Ownership / Directors" | "Other";
type Source = "Client" | "Registry" | "Other";
type Status = "Requested" | "Needs review" | "Reviewed";
type Event = { at: string; action: string; detail: string };
type Facts = { legalName: string; corporateNumber: string; incorporationDate: string; peopleAndRoles: string; amendmentSummary: string };
type OCR = { text: string; confidence: number | null; fields: Partial<Facts> };
type RecordItem = {
  id: string; kind: Kind; source: Source; status: Status; title: string;
  registry: string; reference: string; requestedAt?: string; receivedAt?: string;
  effectiveDate: string; notes: string; evidenceId?: string; fileName?: string; mimeType?: string;
  attachments?: Array<{ evidenceId: string; fileName: string; mimeType: string; receivedAt: string }>;
  ocr?: OCR; facts?: Facts; verifiedAt?: string; verificationNote?: string; events: Event[];
};

const kinds: Kind[] = ["Formation / Articles", "Amendment", "Certificate / Status", "Registry Extract", "Ownership / Directors", "Other"];
const emptyFacts: Facts = { legalName: "", corporateNumber: "", incorporationDate: "", peopleAndRoles: "", amendmentSummary: "" };
const id = () => typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const storageKey = (companyId: string) => `tes_business_corporate_documents_${companyId}`;
const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const readFile = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(reader.error || new Error("Could not read document"));
  reader.readAsDataURL(file);
});

export function CorporateDocumentsSection({ companyId, companyName, corporateNumber, onBusinessEvent }: {
  companyId: string; companyName: string; corporateNumber?: string; onBusinessEvent: (action: string, detail: string) => void;
}) {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [viewFileName, setViewFileName] = useState("");
  const [viewMimeType, setViewMimeType] = useState("application/pdf");
  const [facts, setFacts] = useState<Facts>(emptyFacts);
  const [verificationNote, setVerificationNote] = useState("");
  const [metadata, setMetadata] = useState({ kind: "Formation / Articles" as Kind, source: "Client" as Source, title: "", registry: "", reference: "", effectiveDate: "", notes: "" });
  const [requestOpen, setRequestOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<string | null>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey(companyId)) || "[]");
      setRecords(Array.isArray(stored) ? stored : []);
    } catch { setRecords([]); }
    setSelectedId(null);
  }, [companyId]);

  const selected = records.find((r) => r.id === selectedId) || null;
  const persist = (next: RecordItem[]) => {
    localStorage.setItem(storageKey(companyId), JSON.stringify(next));
    setRecords(next);
  };
  const audit = (action: "CREATE" | "UPDATE", recordId: string, detail: string) => recordAuditEvent({
    action, entityType: "Company", entityId: recordId, companyId, role: "Compliance Administrator", details: detail, actor: "System Administrator",
  });
  const change = (recordId: string, action: string, detail: string, patch: Partial<RecordItem>) => {
    const now = new Date().toISOString();
    persist(records.map((r) => r.id === recordId ? {
      ...r, ...patch, events: [...r.events, { at: now, action, detail }],
    } : r));
    onBusinessEvent(action, `${detail} (${recordId})`);
    audit("UPDATE", recordId, detail);
  };
  const openRecord = async (r: RecordItem) => {
    setSelectedId(r.id); setFacts(r.facts || { ...emptyFacts, ...(r.ocr?.fields || {}) });
    setVerificationNote(r.verificationNote || "");
    setMetadata({ kind: r.kind, source: r.source, title: r.title, registry: r.registry, reference: r.reference, effectiveDate: r.effectiveDate, notes: r.notes });
    setViewUrl(null); setViewFileName(r.fileName || ""); setViewMimeType(r.mimeType || "application/pdf"); setError("");
    if (r.evidenceId) {
      try { setViewUrl((await getEvidencePayload(r.evidenceId))?.dataUrl || null); }
      catch { setError("Evidence could not be loaded from this browser."); }
    }
  };
  const selectFile = (recordId: string | null) => {
    uploadFor.current = recordId;
    fileInput.current?.click();
  };
  const onFile = async (file?: File) => {
    if (!file) return;
    if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)) {
      setError("Use a PDF, JPEG, PNG, or WebP document."); return;
    }
    setBusy(true); setError("");
    const evidenceId = `CORP-${companyId}-${id()}`;
    const now = new Date().toISOString();
    try {
      await putEvidencePayload(evidenceId, await readFile(file), file.type);
      const existing = records.find((r) => r.id === uploadFor.current);
      const attachment = { evidenceId, fileName: file.name, mimeType: file.type, receivedAt: now };
      const record: RecordItem = existing ? {
        ...existing, status: "Needs review", receivedAt: now, evidenceId,
        fileName: file.name, mimeType: file.type, attachments: [...(existing.attachments || (existing.evidenceId && existing.fileName ? [{ evidenceId: existing.evidenceId, fileName: existing.fileName, mimeType: existing.mimeType || "application/pdf", receivedAt: existing.receivedAt || now }] : [])), attachment], ocr: undefined, facts: undefined,
        events: [...existing.events, { at: now, action: "DOCUMENT_RECEIVED", detail: `Received ${file.name}; earlier evidence remains in the evidence store.` }],
      } : {
        id: `DOC-${companyId}-${id()}`, kind: "Formation / Articles", source: "Client",
        status: "Needs review", title: file.name, registry: "", reference: "", effectiveDate: "",
        notes: "", receivedAt: now, evidenceId, fileName: file.name, mimeType: file.type, attachments: [attachment],
        events: [{ at: now, action: "DOCUMENT_RECEIVED", detail: `Received ${file.name}` }],
      };
      persist(existing ? records.map((r) => r.id === existing.id ? record : r) : [record, ...records]);
      onBusinessEvent("CORPORATE_DOCUMENT_RECEIVED", `${file.name} (${record.id})`);
      audit(existing ? "UPDATE" : "CREATE", record.id, `Corporate document evidence received: ${file.name}.`);
      await openRecord({ ...record, facts: undefined });
    } catch (e) { setError(e instanceof Error ? e.message : "Document could not be stored."); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  };
  const requestRegistry = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget), now = new Date().toISOString();
    const record: RecordItem = {
      id: `DOC-${companyId}-${id()}`, kind: String(form.get("kind")) as Kind, source: "Registry",
      status: "Requested", title: String(form.get("title") || "Registry document request").trim(),
      registry: String(form.get("registry") || "").trim(), reference: String(form.get("reference") || "").trim(),
      effectiveDate: "", notes: String(form.get("notes") || "").trim(), requestedAt: now,
      events: [{ at: now, action: "REGISTRY_REQUEST_RECORDED", detail: "Request logged; dispatch/receipt must be confirmed separately." }],
    };
    if (!record.registry || !record.title) return;
    persist([record, ...records]); onBusinessEvent("REGISTRY_REQUEST_RECORDED", `${record.registry}: ${record.title} (${record.id})`);
    audit("CREATE", record.id, `Registry document request recorded: ${record.registry} / ${record.title}.`);
    setRequestOpen(false); setSelectedId(record.id);
  };
  const runOCR = async () => {
    if (!selected?.evidenceId) return;
    setBusy(true); setError("");
    try {
      const payload = await getEvidencePayload(selected.evidenceId);
      if (!payload) throw new Error("Evidence payload is unavailable in this browser.");
      const blob = await (await fetch(payload.dataUrl)).blob();
      const form = new FormData(); form.append("file", blob, selected.fileName || "document.pdf");
      const response = await fetch("/api/business-document-ocr", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "OCR processing failed.");
      const ocr = result as OCR;
      change(selected.id, "OCR_REVIEW_DRAFT", "OCR candidates extracted; no company or shareholder fields were changed.", { ocr });
      setFacts({ ...emptyFacts, ...ocr.fields, ...selected.facts });
    } catch (e) { setError(e instanceof Error ? e.message : "OCR processing failed."); }
    finally { setBusy(false); }
  };
  const verify = () => {
    if (!selected?.evidenceId) return;
    const text = `${selected.ocr?.text || ""} ${facts.legalName} ${facts.corporateNumber}`;
    const nameMatched = Boolean(companyName && normalize(text).includes(normalize(companyName)));
    const numberMatched = Boolean(corporateNumber && normalize(text).includes(normalize(corporateNumber)));
    if (!nameMatched && !numberMatched && verificationNote.trim().length < 15) {
      setError("Company identity is not matched. Record at least 15 characters explaining the manual verification before confirming."); return;
    }
    change(selected.id, "FACTS_REVIEWED", "Reviewer confirmed source-linked corporate facts.", {
      status: "Reviewed", facts, verificationNote: verificationNote.trim(), verifiedAt: new Date().toISOString(),
    });
    setError("");
  };

  return (
    <section className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3.5">
        <div><h2 className="flex items-center gap-2 text-sm font-bold"><FileCheck2 className="size-4 text-primary" /> Corporate Papers & Evidence</h2>
          <p className="text-[11px] text-muted-foreground">Formation, amendments, registry extracts, directors and ownership evidence. Facts remain tied to their source.</p></div>
        <div className="flex gap-2"><button type="button" onClick={() => setRequestOpen(true)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Request from Registry</button>
          <button type="button" onClick={() => selectFile(null)} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"><UploadCloud className="size-3.5" /> Upload Document / OCR</button></div>
      </div>
      {records.some((r) => r.status === "Reviewed") && <div className="grid gap-3 border-b p-5 md:grid-cols-2">
        {records.filter((r) => r.status === "Reviewed").map((r) => <button key={r.id} type="button" onClick={() => void openRecord(r)} className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-left text-xs">
          <strong>{r.kind}: {r.title}</strong><span className="ml-2 text-emerald-700">Source reviewed</span>
          {r.facts?.legalName && <p className="mt-1">Legal name: {r.facts.legalName}</p>}
          {r.facts?.corporateNumber && <p>Corporate number: {r.facts.corporateNumber}</p>}
          {r.facts?.incorporationDate && <p>Incorporation: {r.facts.incorporationDate}</p>}
          {r.facts?.peopleAndRoles && <p className="whitespace-pre-wrap">People / ownership: {r.facts.peopleAndRoles}</p>}
          {r.facts?.amendmentSummary && <p className="whitespace-pre-wrap">Amendment: {r.facts.amendmentSummary}</p>}
          <p className="mt-1 text-muted-foreground">Evidence: {r.fileName} · {r.effectiveDate || "Effective date unrecorded"}</p>
        </button>)}
      </div>}
      <input ref={fileInput} type="file" accept=".pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      {error && <p role="alert" className="mx-5 mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,1fr)]">
        <div className="space-y-2">
          {records.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">No corporate papers or registry requests recorded yet.</p>}
          {records.map((r) => <button key={r.id} type="button" onClick={() => void openRecord(r)} className={`w-full rounded-xl border p-3 text-left text-xs hover:bg-muted/30 ${selectedId === r.id ? "border-primary" : "border-border"}`}>
            <div className="flex justify-between gap-3"><strong className="break-words">{r.title}</strong><span className="shrink-0 font-semibold text-primary">{r.status}</span></div>
            <div className="mt-1 text-muted-foreground">{r.kind} · {r.source}{r.reference ? ` · ${r.reference}` : ""}</div>
            <div className="mt-1 text-muted-foreground">{r.fileName || "Awaiting document"} · {r.events.length} activity events</div>
          </button>)}
        </div>
        <div className="min-w-0 rounded-xl border border-border p-4">
          {!selected ? <p className="text-xs text-muted-foreground">Select a record to inspect evidence, OCR candidates, verified facts and its activity.</p> : <>
            <div className="flex items-start justify-between gap-2"><div><h3 className="text-sm font-bold">{selected.title}</h3><p className="text-xs text-muted-foreground">{selected.registry || selected.source} · {selected.status}</p></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Close record"><X className="size-4" /></button></div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => selectFile(selected.id)} disabled={busy} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Attach received document</button>
              {selected.evidenceId && <button type="button" onClick={() => void runOCR()} disabled={busy} className="flex items-center gap-1 rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-semibold text-primary"><ScanText className="size-3.5" /> {busy ? "Processing…" : "Run OCR"}</button>}
            </div>
            <div className="mt-4 space-y-3 border-t pt-4"><h4 className="text-xs font-bold">Record details</h4>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">Document type<select value={metadata.kind} onChange={(e) => setMetadata({ ...metadata, kind: e.target.value as Kind })} className="mt-1 w-full rounded-lg border bg-background p-2">{kinds.map((k) => <option key={k}>{k}</option>)}</select></label>
                <label className="text-xs">Source<select value={metadata.source} onChange={(e) => setMetadata({ ...metadata, source: e.target.value as Source })} className="mt-1 w-full rounded-lg border bg-background p-2"><option>Client</option><option>Registry</option><option>Other</option></select></label>
              </div>
              {([ ["title", "Document title"], ["registry", "Registry / jurisdiction"], ["reference", "Registry reference"], ["effectiveDate", "Effective date / amendment date"] ] as const).map(([key,label]) => <label key={key} className="block text-xs">{label}<input value={metadata[key]} onChange={(e) => setMetadata({ ...metadata, [key]: e.target.value })} className="mt-1 w-full rounded-lg border bg-background p-2" /></label>)}
              <label className="block text-xs">Notes<textarea value={metadata.notes} onChange={(e) => setMetadata({ ...metadata, notes: e.target.value })} className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
              <button type="button" onClick={() => { if (selected && metadata.title.trim()) change(selected.id, "DOCUMENT_DETAILS_UPDATED", "Updated document classification and provenance.", { ...metadata, title: metadata.title.trim() }); }} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Save record details</button>
            </div>
            <div className="mt-4 border-t pt-4"><h4 className="text-xs font-bold">Evidence</h4>
              {(selected.attachments || (selected.evidenceId && selected.fileName ? [{ evidenceId: selected.evidenceId, fileName: selected.fileName, mimeType: selected.mimeType || "application/pdf", receivedAt: selected.receivedAt || "" }] : [])).map((attachment) => <button key={attachment.evidenceId} type="button" onClick={async () => { try { setViewUrl((await getEvidencePayload(attachment.evidenceId))?.dataUrl || null); setViewFileName(attachment.fileName); setViewMimeType(attachment.mimeType); } catch { setError("Evidence could not be loaded."); } }} className="mr-2 mt-2 rounded-lg border px-2 py-1 text-xs">{attachment.fileName}</button>)}
              {viewUrl && viewFileName ? <div className="mt-2 h-72 overflow-hidden rounded-lg border"><SecureDocumentViewer fileName={viewFileName} mimeType={viewMimeType} dataUrl={viewUrl} documentTitle={selected.title} /></div> : <p className="mt-2 text-xs text-muted-foreground">{selected.evidenceId ? "Evidence unavailable in this browser." : "No document received yet."}</p>}
            </div>
            {selected.evidenceId && <div className="mt-4 space-y-3 border-t pt-4"><h4 className="text-xs font-bold">Review source facts</h4>
              <p className="text-[11px] text-muted-foreground">OCR suggestions require review. Directors and ownership are advisory until separately entered and linked to evidence.</p>
              {([['legalName','Legal name'],['corporateNumber','Corporate number'],['incorporationDate','Incorporation date'],['peopleAndRoles','People, roles and ownership'],['amendmentSummary','Amendment / filing summary']] as const).map(([key,label]) => <label key={key} className="block text-xs font-medium">{label}
                {key === 'peopleAndRoles' || key === 'amendmentSummary' ? <textarea value={facts[key]} onChange={(e) => setFacts({ ...facts, [key]: e.target.value })} rows={2} className="mt-1 w-full rounded-lg border bg-background p-2" /> : <input type="text" value={facts[key]} onChange={(e) => setFacts({ ...facts, [key]: e.target.value })} className="mt-1 w-full rounded-lg border bg-background p-2" />}
              </label>)}
              <label className="block text-xs font-medium">Identity verification note (required when name/number differs)<textarea value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
              <button type="button" onClick={verify} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Confirm reviewed facts</button>
              {selected.ocr && <details className="text-xs"><summary>OCR source text · {selected.ocr.confidence === null ? "confidence unavailable" : `${Math.round(selected.ocr.confidence * 100)}%`}</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2">{selected.ocr.text}</pre></details>}
              {selected.verifiedAt && <p className="text-xs text-emerald-700">Reviewed {new Date(selected.verifiedAt).toLocaleString()}. Source-linked facts are available here for advice and follow-up.</p>}
            </div>}
            <details className="mt-4 border-t pt-3 text-xs"><summary className="font-semibold">Activity ({selected.events.length})</summary><div className="mt-2 space-y-2">{selected.events.map((event, i) => <p key={`${event.at}-${i}`}>{new Date(event.at).toLocaleString()} · {event.action}: {event.detail}</p>)}</div></details>
          </>}
        </div>
      </div>
      {requestOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><form onSubmit={requestRegistry} className="w-full max-w-lg space-y-3 rounded-2xl bg-card p-6 shadow-2xl">
        <div className="flex justify-between"><h3 className="text-sm font-bold">Record a Registry Request</h3><button type="button" onClick={() => setRequestOpen(false)}><X className="size-4" /></button></div>
        <p className="text-xs text-muted-foreground">This tracks the request. It does not send it to the registry automatically.</p>
        <label className="block text-xs">Document type<select name="kind" className="mt-1 w-full rounded-lg border bg-background p-2">{kinds.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label className="block text-xs">Title<input name="title" required className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
        <label className="block text-xs">Registry / jurisdiction<input name="registry" required className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
        <label className="block text-xs">Request reference<input name="reference" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
        <label className="block text-xs">Notes<textarea name="notes" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
        <button type="submit" className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"><Plus className="size-3.5" /> Record request</button>
      </form></div>}
    </section>
  );
}
