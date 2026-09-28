"use client";

import React, { useEffect, useRef, useState } from "react";
import { Mail, Plus, ShieldCheck, UploadCloud } from "lucide-react";
import { putEvidencePayload, getEvidencePayload } from "@/lib/evidence-payload-store";
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer";
import { recordAuditEvent } from "@/lib/audit-logger";
import {
  AUDIT_REGIMES, auditCaseEvent, createAuditTasks, daysToAuditDeadline,
  loadAuditCases, newAuditId, saveAuditCases, summarizeAuditTasks,
  type AuditCaseSource, type AuditDocumentPurpose, type AuditTaskState, type CarrierAuditCase,
} from "@/lib/audit-case-store";

const readDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(reader.error || new Error("Could not read file."));
  reader.readAsDataURL(file);
});
const sectionUrl = (companyId: string, section: string) => {
  const segment: Record<string, string> = { Driver: "drivers", Vehicle: "vehicles", Company: "profile", Insurance: "insurance", Authority: "authorities" };
  return segment[section] ? `/companies/${encodeURIComponent(companyId)}/${segment[section]}` : null;
};
const states: AuditTaskState[] = ["NOT_ASSESSED", "APPLICABILITY_REVIEW", "REQUESTED", "RECEIVED", "VERIFIED", "NOT_APPLICABLE"];

export function AuditCasesSection({ companyId, companyName, onBusinessEvent }: {
  companyId: string; companyName: string; onBusinessEvent: (action: string, detail: string) => void;
}) {
  const [cases, setCases] = useState<CarrierAuditCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<{ name: string; mimeType: string; dataUrl: string } | null>(null);
  const [requestTaskId, setRequestTaskId] = useState<string | null>(null);
  const [uploadPurpose, setUploadPurpose] = useState<AuditDocumentPurpose>("Notice");
  const [busy, setBusy] = useState(false);
  const [revisedDeadline, setRevisedDeadline] = useState("");
  const [deadlineReason, setDeadlineReason] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);

  useEffect(() => { setCases(loadAuditCases(companyId)); setSelectedId(null); }, [companyId]);
  const selected = cases.find((item) => item.id === selectedId) || null;
  const persist = (next: CarrierAuditCase[]) => { saveAuditCases(companyId, next); setCases(next); };
  const audit = (caseId: string, action: string, detail: string) => {
    onBusinessEvent(action, `${detail} (${caseId})`);
    recordAuditEvent({ action: "UPDATE", entityType: "Company", entityId: caseId, companyId,
      role: "Compliance Administrator", details: detail, actor: "System Administrator" });
  };
  const update = (caseId: string, action: string, description: string, apply: (item: CarrierAuditCase) => CarrierAuditCase, evidenceId?: string) => {
    try {
      persist(cases.map((item) => item.id !== caseId ? item : {
        ...apply(item), events: [...item.events, auditCaseEvent(action, description, evidenceId)],
      }));
      audit(caseId, action, description); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Audit update failed."); }
  };
  const create = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const title = String(data.get("title") || "").trim();
    const source = String(data.get("source")) as AuditCaseSource;
    const regimeId = String(data.get("regimeId") || "");
    const regime = AUDIT_REGIMES.find((item) => item.id === regimeId);
    const deadline = String(data.get("deadline") || "");
    const historical = source === "Historical report";
    if (!title || (!historical && !deadline)) { setError("Title and submission deadline are required for a current audit."); return; }
    const caseId = newAuditId("AUD");
    const item: CarrierAuditCase = {
      id: caseId, companyId, title, regimeId, regimeName: regime?.name || String(data.get("customRegime") || "Unmapped audit"),
      authority: regime?.authority || String(data.get("authority") || "").trim(), source,
      status: "Notice received",
      noticeDate: String(data.get("noticeDate") || ""), deadline, periodStart: String(data.get("periodStart") || ""),
      periodEnd: String(data.get("periodEnd") || ""), reference: String(data.get("reference") || "").trim(),
      receivedAt: new Date().toISOString(), historical, notes: String(data.get("notes") || "").trim(),
      tasks: historical ? [] : createAuditTasks(regimeId), documents: [], requests: [],
      events: [auditCaseEvent(historical ? "HISTORICAL_AUDIT_RECORDED" : "AUDIT_INITIATED", `${source}: ${title}; deadline ${deadline || "historical"}.`)],
    };
    try { persist([item, ...cases]); setSelectedId(caseId); setShowCreate(false); setError("");
      audit(caseId, historical ? "HISTORICAL_AUDIT_RECORDED" : "AUDIT_INITIATED", `${title}; deadline ${deadline || "historical"}.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create audit case."); }
  };
  const pickUpload = (purpose: AuditDocumentPurpose) => { setUploadPurpose(purpose); uploadInput.current?.click(); };
  const receiveFile = async (file?: File) => {
    if (!file || !selected) return;
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Use a PDF or supported image."); return; }
    setBusy(true); setError("");
    const caseId = selected.id, evidenceId = `AUD-EV-${companyId}-${newAuditId("E")}`;
    try {
      await putEvidencePayload(evidenceId, await readDataUrl(file), file.type);
      const purpose = uploadPurpose;
      const document = { id: newAuditId("ADOC"), purpose, evidenceId, name: file.name, mimeType: file.type, addedAt: new Date().toISOString(), note: "" };
      update(caseId, "AUDIT_DOCUMENT_ATTACHED", `${purpose}: ${file.name}`, (item) => ({
        ...item, documents: [...item.documents, document],
        status: purpose === "Audit report" ? "Report received" : purpose === "Submission proof" ? "Submitted" : item.status,
        reportDate: purpose === "Audit report" ? new Date().toISOString().slice(0,10) : item.reportDate,
        submittedAt: purpose === "Submission proof" ? new Date().toISOString() : item.submittedAt,
      }), evidenceId);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not store audit evidence."); }
    finally { setBusy(false); if (uploadInput.current) uploadInput.current.value = ""; }
  };
  const openDocument = async (evidenceId: string, name: string, mimeType: string) => {
    try { const payload = await getEvidencePayload(evidenceId); if (!payload) throw new Error("Evidence unavailable in this browser.");
      setView({ name, mimeType, dataUrl: payload.dataUrl });
    } catch (err) { setError(err instanceof Error ? err.message : "Evidence unavailable."); }
  };
  const setTaskState = async (taskId: string, state: AuditTaskState, note: string, evidenceId: string) => {
    if (!selected) return;
    if (state === "RECEIVED" && !evidenceId.trim()) { setError("A received document needs an evidence ID from its source section."); return; }
    if (state === "VERIFIED") {
      if (!evidenceId.trim() || note.trim().length < 10) { setError("Operator verification requires a source evidence ID and an assessment note of at least 10 characters."); return; }
      try { if (!(await getEvidencePayload(evidenceId.trim()))) { setError("Evidence payload was not found in this browser. Keep this task as received/review pending until its source can be checked."); return; } }
      catch { setError("Evidence could not be checked. Verification was not saved."); return; }
    }
    if (state === "NOT_APPLICABLE" && !note.trim()) { setError("Record why the requirement does not apply."); return; }
    update(selected.id, "AUDIT_TASK_ASSESSED", `${taskId} → ${state}. ${note}`, (item) => ({ ...item,
      status: item.status === "Notice received" ? "Preparing" : item.status,
      tasks: item.tasks.map((task) => task.id === taskId ? { ...task, state, note,
        evidenceIds: evidenceId.trim() ? [...new Set([...task.evidenceIds, evidenceId.trim()])] : task.evidenceIds } : task),
    }), evidenceId.trim() || undefined);
  };
  const draftRequest = (taskId: string, channel: "Email" | "Portal") => {
    if (!selected) return;
    const task = selected.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const subject = `Audit document request: ${task.evidenceType}`;
    const message = `Hello,\n\nFor the ${selected.title} audit (submission deadline ${selected.deadline}), please provide ${task.evidenceType}. ${task.condition ? `Applicability must first be confirmed: ${task.condition}.` : ""}\n\nPlease submit this through the TES portal or reply to the documented request.\n\nThank you,\nTES`;
    update(selected.id, "AUDIT_REQUEST_DRAFTED", `${channel} request drafted for ${task.evidenceType}; not sent.`, (item) => ({ ...item,
      requests: [...item.requests, { id: newAuditId("AREQ"), taskId, channel, status: "Draft", subject, message, createdAt: new Date().toISOString() }],
    }));
    setRequestTaskId(taskId);
  };
  const personalizeRequest = (requestId: string, subject: string, message: string) => {
    if (!selected || !subject.trim() || !message.trim()) { setError("Request subject and message are required."); return; }
    update(selected.id, "AUDIT_REQUEST_PERSONALIZED", `Edited request ${requestId}; delivery remains pending.`, (item) => ({ ...item,
      requests: item.requests.map((request) => request.id === requestId && request.status === "Draft" ? { ...request, subject: subject.trim(), message: message.trim() } : request),
    }));
  };
  const markSent = (requestId: string, proof: string) => {
    if (!selected || !proof.trim()) { setError("Record a message ID, ticket ID, or other dispatch proof before marking sent."); return; }
    update(selected.id, "AUDIT_REQUEST_SENT_EXTERNALLY", `Request ${requestId} marked sent with dispatch proof ${proof.trim()}.`, (item) => ({ ...item,
      requests: item.requests.map((request) => request.id === requestId ? { ...request, status: "Sent", sentAt: new Date().toISOString(), dispatchProof: proof.trim() } : request),
      tasks: item.tasks.map((task) => task.id === item.requests.find((request) => request.id === requestId)?.taskId && task.state === "NOT_ASSESSED" ? { ...task, state: "REQUESTED" } : task),
    }));
  };
  const addCustomTask = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!selected) return;
    const data = new FormData(e.currentTarget), evidenceType = String(data.get("evidenceType") || "").trim();
    if (!evidenceType) return;
    const section = String(data.get("section") || "Company");
    update(selected.id, "AUDIT_TASK_ADDED", `Case-specific requirement: ${evidenceType}.`, (item) => ({ ...item, tasks: [...item.tasks, {
      id: newAuditId("ATASK"), requirementId: "case-specific", evidenceRequirementId: "case-specific",
      requirement: evidenceType, evidenceType, section, necessity: "required", state: "NOT_ASSESSED", evidenceIds: [], note: "",
    }] })); e.currentTarget.reset();
  };

  return <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3.5">
      <div><h2 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="size-4 text-primary" /> Carrier Audits</h2>
        <p className="text-[11px] text-muted-foreground">A notice and deadline initiate preparedness. Keep submission proof, result, and historical reports in the same case.</p></div>
      <button type="button" onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"><Plus className="size-3.5" /> New audit case</button>
    </div>
    {error && <p role="alert" className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
    {showCreate && <form onSubmit={create} className="grid gap-3 border-b p-5 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <label className="sm:col-span-2">Audit title<input name="title" required className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
      <label>Initiated by<select name="source" className="mt-1 w-full rounded-lg border bg-background p-2"><option>Letter</option><option>Email</option><option>Internal message</option><option>Historical report</option></select></label>
      <label>Regime<select name="regimeId" className="mt-1 w-full rounded-lg border bg-background p-2"><option value="">Other / manually scoped</option>{AUDIT_REGIMES.map((regime) => <option key={regime.id} value={regime.id}>{regime.name}</option>)}</select></label>
      <label>Other audit type<input name="customRegime" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
      <label>Authority<input name="authority" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
      <label>Notice date<input name="noticeDate" type="date" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
      <label>Submission deadline<input name="deadline" type="date" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
      <label>Audit period from<input name="periodStart" type="date" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
      <label>Audit period to<input name="periodEnd" type="date" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
      <label>Notice/reference #<input name="reference" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
      <label className="sm:col-span-2">Notes<textarea name="notes" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
      <div className="flex items-end"><button type="submit" className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground">Create case</button></div>
      <p className="sm:col-span-2 lg:col-span-4 text-muted-foreground">Historical reports are stored as client-provided evidence. TES does not certify prior compliance. Upload the notice or report after creating the case.</p>
    </form>}
    <input ref={uploadInput} type="file" accept=".pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void receiveFile(e.target.files?.[0])} />
    <div className="grid gap-5 p-5 xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
      <div className="space-y-2">{cases.length === 0 && <p className="rounded-xl border border-dashed p-5 text-xs text-muted-foreground">No audits recorded for this carrier.</p>}
        {cases.map((item) => { const days = daysToAuditDeadline(item.deadline), counts = summarizeAuditTasks(item.tasks);
          return <button key={item.id} type="button" onClick={() => { setSelectedId(item.id); setView(null); setError(""); setRevisedDeadline(item.deadline); setDeadlineReason(""); }} className={`w-full rounded-xl border p-3 text-left text-xs ${selectedId === item.id ? "border-primary" : "border-border"}`}>
            <div className="flex justify-between gap-2"><strong>{item.title}</strong><span>{item.status}</span></div>
            <p className="mt-1 text-muted-foreground">{item.regimeName} · {item.source}</p>
            <p className="mt-1 font-medium">{item.historical ? "Historical report" : days === null ? "Deadline missing" : `${days < 0 ? "Overdue" : days === 0 ? "Due today" : `${days} days left`} · ${item.deadline}`}</p>
            <p className="mt-1 text-muted-foreground">{counts.unresolved} unresolved · {counts.applicabilityReview} applicability reviews</p>
          </button>;
        })}
      </div>
      {!selected ? <div className="rounded-xl border border-dashed p-8 text-center text-xs text-muted-foreground">Select a case to work the deadline and inspect its records.</div> : <div className="min-w-0 space-y-5">
        <div className="rounded-xl border p-4"><h3 className="text-sm font-bold">{selected.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{companyName} · {selected.authority || "Authority not recorded"} · {selected.reference || "No reference"}</p>
          <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3"><p>Notice: <strong>{selected.noticeDate || "Not recorded"}</strong></p><p>Submission deadline: <strong>{selected.deadline || "Historical"}</strong></p><p>Status: <strong>{selected.status}</strong></p></div>
          {!selected.historical && <><p className="mt-2 text-[11px] text-muted-foreground">The deadline controls this case. Requirement checks below remain unresolved until assessed with source evidence; no percentage is inferred from document counts.</p>
            <div className="mt-3 flex flex-wrap items-end gap-2 text-xs"><label>Revised deadline<input type="date" value={revisedDeadline} onChange={(e) => setRevisedDeadline(e.target.value)} className="mt-1 block rounded-lg border bg-background p-2" /></label>
              <label className="min-w-[190px] flex-1">Reason / amended notice reference<input value={deadlineReason} onChange={(e) => setDeadlineReason(e.target.value)} className="mt-1 block w-full rounded-lg border bg-background p-2" /></label>
              <button type="button" onClick={() => { if (!revisedDeadline || !deadlineReason.trim()) { setError("A revised deadline and reason are required."); return; } if (revisedDeadline !== selected.deadline) update(selected.id, "AUDIT_DEADLINE_REVISED", `${selected.deadline} → ${revisedDeadline}. ${deadlineReason.trim()}`, (item) => ({ ...item, deadline: revisedDeadline })); }} className="rounded-lg border px-3 py-2">Save deadline revision</button></div>
          </>}
          <div className="mt-3 flex flex-wrap gap-2">{(["Notice", "Submission proof", "Audit report", "Other"] as AuditDocumentPurpose[]).map((purpose) => <button key={purpose} type="button" disabled={busy} onClick={() => pickUpload(purpose)} className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"><UploadCloud className="size-3.5" /> Attach {purpose.toLowerCase()}</button>)}</div>
          {selected.documents.length > 0 && <div className="mt-3 space-y-1">{selected.documents.map((document) => <button key={document.id} type="button" onClick={() => void openDocument(document.evidenceId, document.name, document.mimeType)} className="block text-left text-xs text-primary underline">{document.purpose}: {document.name} · {new Date(document.addedAt).toLocaleString()}</button>)}</div>}
          {view && <div className="mt-3 h-80 overflow-hidden rounded-xl border"><SecureDocumentViewer fileName={view.name} mimeType={view.mimeType} dataUrl={view.dataUrl} documentTitle={`${selected.title} — ${view.name}`} onClose={() => setView(null)} /></div>}
          {selected.status === "Report received" && selected.documents.some((document) => document.purpose === "Audit report") && <button type="button" onClick={() => update(selected.id, "AUDIT_CLOSED", "Audit case closed after report receipt.", (item) => ({ ...item, status: "Closed" }))} className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-semibold">Close case</button>}
          {selected.documents.some((document) => document.purpose === "Audit report") && <label className="mt-3 block text-xs">Report issue date<input type="date" value={selected.reportDate || ""} onChange={(e) => update(selected.id, "AUDIT_REPORT_DATE_RECORDED", `Report issue date ${e.target.value}.`, (item) => ({ ...item, reportDate: e.target.value }))} className="mt-1 block rounded-lg border bg-background p-2" /></label>}
          {selected.documents.some((document) => document.purpose === "Audit report") && <label className="mt-3 block text-xs">Report outcome / findings<textarea key={selected.id} defaultValue={selected.outcome || ""} onBlur={(e) => { if (e.target.value !== (selected.outcome || "")) update(selected.id, "AUDIT_OUTCOME_RECORDED", "Recorded report outcome and findings.", (item) => ({ ...item, outcome: e.target.value })); }} className="mt-1 w-full rounded-lg border bg-background p-2" /></label>}
        </div>
        {!selected.historical && <div className="rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><h4 className="text-xs font-bold">Preparedness work queue</h4><span className="text-xs text-muted-foreground">{summarizeAuditTasks(selected.tasks).verified} verified · {summarizeAuditTasks(selected.tasks).unresolved} unresolved</span></div>
          <p className="mt-1 text-[11px] text-muted-foreground">Requirement list comes from the selected regime. Conditional items need applicability review. Link existing evidence IDs; documents remain owned by their source section.</p>
          <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">{selected.tasks.map((task) => <AuditTaskRow key={task.id} task={task} companyId={companyId} onSave={setTaskState} onDraft={draftRequest} />)}</div>
          <form onSubmit={addCustomTask} className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3 text-xs"><label>Case-specific document<input name="evidenceType" required className="mt-1 rounded-lg border bg-background p-2" /></label><label>Section<select name="section" className="mt-1 rounded-lg border bg-background p-2"><option>Company</option><option>Driver</option><option>Vehicle</option><option>Insurance</option><option>Shipment</option></select></label><button type="submit" className="rounded-lg border px-3 py-2">Add to case</button></form>
        </div>}
        <div className="rounded-xl border p-4"><h4 className="flex items-center gap-2 text-xs font-bold"><Mail className="size-4" /> Client document requests</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">Drafts are not delivered automatically. A ticket/email integration must send them; record dispatch proof only after actual delivery.</p>
          {selected.requests.length === 0 && <p className="mt-3 text-xs text-muted-foreground">No requests drafted.</p>}
          {selected.requests.map((request) => <RequestRow key={request.id} request={request} expanded={requestTaskId === request.taskId} onExpand={() => setRequestTaskId(request.taskId)} onMarkSent={markSent} onPersonalize={personalizeRequest} />)}
        </div>
        <details className="rounded-xl border p-4 text-xs"><summary className="font-bold">Audit case history ({selected.events.length})</summary><div className="mt-3 space-y-2">{selected.events.map((event) => <p key={event.id} className="border-t pt-2">{new Date(event.at).toLocaleString()} · {event.action}: {event.description}{event.evidenceId ? ` · Evidence ${event.evidenceId}` : ""}</p>)}</div></details>
      </div>}
    </div>
  </section>;
}

function AuditTaskRow({ task, companyId, onSave, onDraft }: {
  task: CarrierAuditCase["tasks"][number]; companyId: string;
  onSave: (id: string, state: AuditTaskState, note: string, evidenceId: string) => void | Promise<void>;
  onDraft: (id: string, channel: "Email" | "Portal") => void;
}) {
  const [state, setState] = useState<AuditTaskState>(task.state);
  const [note, setNote] = useState(task.note);
  const [evidenceId, setEvidenceId] = useState("");
  useEffect(() => { setState(task.state); setNote(task.note); setEvidenceId(""); }, [task.id, task.state, task.note]);
  const url = sectionUrl(companyId, task.section);
  return <div className="rounded-lg border p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong>{task.requirement}</strong><span>{task.section} · {task.necessity}</span></div>
    <p className="mt-1">{task.evidenceType}</p>{task.condition && <p className="mt-1 text-amber-700">Conditional: {task.condition}</p>}
    <div className="mt-2 flex flex-wrap items-end gap-2"><label>Status<select value={state} onChange={(e) => setState(e.target.value as AuditTaskState)} className="mt-1 block rounded border bg-background p-1.5">{states.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Source evidence ID<input value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)} placeholder={task.evidenceIds[0] || "Evidence ID"} className="mt-1 block rounded border bg-background p-1.5" /></label>
      <label className="min-w-[150px] flex-1">Assessment note<input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 block w-full rounded border bg-background p-1.5" /></label>
      <button type="button" onClick={() => onSave(task.id, state, note, evidenceId || task.evidenceIds[0] || "")} className="rounded bg-primary px-2 py-1.5 font-semibold text-primary-foreground">Save</button>
      <button type="button" onClick={() => onDraft(task.id, "Portal")} className="rounded border px-2 py-1.5">Portal draft</button>
      <button type="button" onClick={() => onDraft(task.id, "Email")} className="rounded border px-2 py-1.5">Email draft</button>
      {url && <a href={url} className="px-1 py-1.5 text-primary underline">Open {task.section}</a>}
    </div>{task.evidenceIds.length > 0 && <p className="mt-2 text-muted-foreground">Linked evidence: {task.evidenceIds.join(", ")}</p>}
  </div>;
}
function RequestRow({ request, expanded, onExpand, onMarkSent, onPersonalize }: {
  request: CarrierAuditCase["requests"][number]; expanded: boolean; onExpand: () => void;
  onMarkSent: (id: string, proof: string) => void;
  onPersonalize: (id: string, subject: string, message: string) => void;
}) {
  const [proof, setProof] = useState("");
  const [subject, setSubject] = useState(request.subject);
  const [message, setMessage] = useState(request.message);
  useEffect(() => { setSubject(request.subject); setMessage(request.message); }, [request.subject, request.message]);
  return <div className="mt-2 rounded-lg border p-3 text-xs"><button type="button" onClick={onExpand} className="font-semibold">{request.channel} · {request.status} · {request.subject}</button>
    {expanded && <>{request.status === "Draft" ? <div className="mt-2 space-y-2"><input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded border bg-background p-2" aria-label="Request subject" />
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7} className="w-full rounded border bg-background p-2" aria-label="Personalized request message" />
      <button type="button" onClick={() => onPersonalize(request.id, subject, message)} className="rounded border px-3 py-1.5">Save personalized draft</button></div>
      : <pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-2">{request.message}</pre>}
      {request.status !== "Sent" && <div className="mt-2 flex gap-2"><input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Actual ticket/message ID" className="min-w-0 flex-1 rounded border bg-background p-2" /><button type="button" onClick={() => onMarkSent(request.id, proof)} className="rounded border px-3">Record sent</button></div>}
      {request.dispatchProof && <p className="mt-2">Dispatch proof: {request.dispatchProof}</p>}
    </>}
  </div>;
}
