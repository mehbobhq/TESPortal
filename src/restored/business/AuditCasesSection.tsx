"use client";

import React, { useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable";
import { userMessage } from "@/lib/canonical-ui/unavailable";
import { unavailable } from "@/src/restored/business/adapter";

/**
 * Carrier Audits. The original kept audit cases, evidence and requests in this browser. There is no canonical audit-case
 * domain (no table, no operation), so the section keeps its header, its "New audit case" form and its empty list, and creating a
 * case refuses honestly: nothing is saved and nothing is kept in the browser. The audit regime names below are the two regimes
 * the original offered (labels only).
 */
const REGIME_LABELS = ["Alberta NSC Full Facility Audit", "FMCSA New Entrant Safety Audit"];

export function AuditCasesSection() {
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");

  const create = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(userMessage(unavailable.auditCase()));
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3.5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="size-4 text-primary" /> Carrier Audits</h2>
          <p className="text-[11px] text-muted-foreground">A notice and deadline initiate preparedness. Keep submission proof, result, and historical reports in the same case.</p>
        </div>
        <button type="button" onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"><Plus className="size-3.5" /> New audit case</button>
      </div>
      {error && <p role="alert" className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
      {showCreate && (
        <form onSubmit={create} className="grid gap-3 border-b p-5 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <label className="sm:col-span-2">Audit title<input name="title" required className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
          <label>Initiated by<select name="source" className="mt-1 w-full rounded-lg border bg-background p-2"><option>Letter</option><option>Email</option><option>Internal message</option><option>Historical report</option></select></label>
          <label>Regime<select name="regimeId" className="mt-1 w-full rounded-lg border bg-background p-2"><option value="">Other / manually scoped</option>{REGIME_LABELS.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
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
          <div className="sm:col-span-2 lg:col-span-4"><CanonicalUnavailable action="Creating an audit case" reason="carrier audit cases have no canonical domain yet (no table or operation), so submitting will not save anything." /></div>
        </form>
      )}
      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <div className="space-y-2">
          <p className="rounded-xl border border-dashed p-5 text-xs text-muted-foreground">No audits recorded for this carrier.</p>
        </div>
        <div className="rounded-xl border border-dashed p-8 text-center text-xs text-muted-foreground">Select a case to work the deadline and inspect its records.</div>
      </div>
    </section>
  );
}
