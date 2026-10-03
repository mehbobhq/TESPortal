"use client";

import React, { useState } from "react";
import type { CompanyDriverStore, DriverPerformanceEvent } from "@/types/drivers";
import type { PerformanceFoundationState } from "@/lib/performance-foundation-state";
import {
  CLASSIFICATION_OUTCOMES, CONTRIBUTING_FACTOR_DOMAINS, PREVENTABILITY_VALUES, RESPONSIBILITY_CATALOGUE_VERSION, RESPONSIBILITY_PARTIES, RESPONSIBILITY_STANDALONE, ROOT_CAUSE_STATUSES,
  completePerformanceInvestigation, getActiveDetermination, getActiveDeterminations, getInvestigationsForEvent, openPerformanceInvestigation, recordPerformanceDetermination,
  reopenPerformanceInvestigation, resolvePreventability, setInvestigationContributingFactors, updatePerformanceInvestigation,
  type ContributingFactorDomain,
} from "@/lib/performance-investigation";
import { setPerformanceInvestigationRequirement } from "@/lib/performance-workflow";

const inputClass = "mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";
const human = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const SOURCE_LABEL = { INVESTIGATION: "Investigation determination", LEGACY_DETERMINATION: "Legacy Collision determination (read-only)", DEPRECATED_COLLISION_FIELD: "Deprecated Collision field (read-only)" } as const;
const today = () => new Date().toISOString().slice(0, 10);

type Writer = (store: CompanyDriverStore) => { state: CompanyDriverStore };
export type EngineRun = (description: string, writer: Writer) => void;

function Select({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label className="block min-w-0 text-[11px] font-semibold text-foreground">{label}<select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}><option value="">Select...</option>{options.map((option) => <option key={option} value={option}>{human(option)}</option>)}</select></label>;
}
const Text = ({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) => (
  <label className="block min-w-0 text-[11px] font-semibold text-foreground">{label}{rows ? <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} /> : <input value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />}</label>
);
const Submit = ({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) => <button type="button" disabled={disabled} onClick={onClick} className="rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] font-bold hover:bg-muted disabled:opacity-40">{children}</button>;

/**
 * Collision-facing adapter over the COMMON investigation writers. It adds no model of its own: every action calls the engine
 * (investigation, determinations, contributing factors, requirement) and persists through applyPerformanceEngineWrite.
 */
export function CollisionInvestigationPanel({ event, state, run }: { event: DriverPerformanceEvent; state: PerformanceFoundationState; run: EngineRun }) {
  const [actor, setActor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [classification, setClassification] = useState({ outcome: "", notes: "" });
  const [prevent, setPrevent] = useState({ value: "", notes: "" });
  const [resp, setResp] = useState({ primary: "", contributing: [] as string[], notes: "" });
  const [root, setRoot] = useState({ category: "", finding: "", status: "" });
  const [factors, setFactors] = useState<Array<{ domain: string; factor: string; role: "PRIMARY" | "SECONDARY" }>>([]);
  const [summary, setSummary] = useState("");
  const [requireReason, setRequireReason] = useState("");

  const investigations = getInvestigationsForEvent(state, event.id);
  const active = investigations.filter((item) => item.status === "OPEN" || item.status === "AWAITING_INFORMATION").pop();
  const completed = investigations.filter((item) => item.status === "COMPLETED").pop();
  const resolved = resolvePreventability(state, event);
  const requirement = (event as { investigationRequirement?: { required: boolean; reason?: string } }).investigationRequirement;
  const act = (description: string, writer: Writer) => {
    if (!actor.trim()) { setError("Enter your name before recording anything."); return; }
    try { setError(null); run(description, writer); } catch (caught) { setError(caught instanceof Error ? caught.message : "The action could not be recorded."); }
  };
  const by = actor.trim();
  const activeDetermination = (subject: "CLASSIFICATION" | "PREVENTABILITY" | "RESPONSIBILITY" | "ROOT_CAUSE") => (active ? getActiveDetermination(state, active.id, subject) : undefined);
  const rootCauses = active ? getActiveDeterminations(state, active.id, "ROOT_CAUSE") : [];

  const recordPreventability = () => act("Recorded Collision preventability through the investigation engine.", (store) => {
    // One click: open an investigation first when none is active, then record against it.
    const opened = active ? { state: store, id: active.id } : (() => { const result = openPerformanceInvestigation(store, { eventId: event.id, openedBy: by, openingReason: "Collision preventability review" }); return { state: result.state, id: result.investigation.id }; })();
    return recordPerformanceDetermination(opened.state, { investigationId: opened.id, assessment: { subject: "PREVENTABILITY", value: prevent.value as never, opportunityNotes: prevent.notes.trim() || undefined }, determinedBy: by, determinationDate: today(), rationale: prevent.notes.trim() || undefined });
  });

  return (
    <div className="space-y-3" data-testid="collision-investigation">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-2.5">
        <Text label="Acting as" value={actor} onChange={setActor} />
        <div className="min-w-0 flex-1 text-[11px]" data-testid="collision-preventability-current">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Preventability</div>
          <div className="font-semibold text-foreground">{resolved ? `${human(resolved.value)} - ${SOURCE_LABEL[resolved.source]}` : "Not determined"}</div>
        </div>
      </div>
      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
          <div className="text-[11px] font-bold">Preventability</div>
          <div className="grid gap-2 sm:grid-cols-2"><Select label="Determination" value={prevent.value} options={PREVENTABILITY_VALUES} onChange={(value) => setPrevent({ ...prevent, value })} /><Text label="Opportunity notes" value={prevent.notes} onChange={(notes) => setPrevent({ ...prevent, notes })} /></div>
          <Submit disabled={!prevent.value} onClick={recordPreventability}>{activeDetermination("PREVENTABILITY") ? "Amend preventability" : "Record preventability"}</Submit>
          {!active ? <p className="text-[10px] text-muted-foreground">Recording opens an investigation for this Collision if none is active.</p> : null}
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
          <div className="text-[11px] font-bold">Investigation</div>
          <p className="text-[11px] text-muted-foreground">{active ? `Open since ${active.openedAt.slice(0, 10)} (${human(active.status)})` : completed ? `Completed ${completed.completedAt?.slice(0, 10) || ""}` : "No investigation opened."}{requirement?.required ? " Reviewer-required." : ""}</p>
          <div className="flex flex-wrap items-end gap-2">
            {!active && !completed ? <Submit onClick={() => act("Opened Collision investigation.", (store) => openPerformanceInvestigation(store, { eventId: event.id, openedBy: by }))}>Open investigation</Submit> : null}
            {completed && !active ? <Submit onClick={() => act("Reopened Collision investigation.", (store) => reopenPerformanceInvestigation(store, completed.id, { by }))}>Reopen</Submit> : null}
            {active ? <Submit onClick={() => act("Completed Collision investigation.", (store) => completePerformanceInvestigation(store, active.id, { by }))}>Complete investigation</Submit> : null}
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
            <Text label="Reviewer requirement - reason (optional)" value={requireReason} onChange={setRequireReason} />
            <Submit onClick={() => act("Reviewer set the Collision investigation requirement.", (store) => setPerformanceInvestigationRequirement(store, event.id, { required: !requirement?.required, reason: requireReason, setBy: by }))}>{requirement?.required ? "Withdraw my requirement" : "Require investigation"}</Submit>
          </div>
        </div>
      </div>

      {active ? (
        <div className="grid gap-3 lg:grid-cols-2" data-testid="collision-investigation-forms">
          <div className="space-y-2 rounded-lg border border-border bg-background p-3">
            <div className="text-[11px] font-bold">Classification{activeDetermination("CLASSIFICATION") ? " (recorded)" : " (needed to complete)"}</div>
            <div className="grid gap-2 sm:grid-cols-2"><Select label="Outcome" value={classification.outcome} options={CLASSIFICATION_OUTCOMES} onChange={(outcome) => setClassification({ ...classification, outcome })} /><Text label="Notes" value={classification.notes} onChange={(notes) => setClassification({ ...classification, notes })} /></div>
            <Submit disabled={!classification.outcome} onClick={() => act("Recorded Collision classification.", (store) => recordPerformanceDetermination(store, { investigationId: active.id, assessment: { subject: "CLASSIFICATION", outcome: classification.outcome as never, notes: classification.notes.trim() || undefined }, determinedBy: by, determinationDate: today() }))}>Record classification</Submit>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-background p-3">
            <div className="text-[11px] font-bold">Responsibility</div>
            <div className="grid gap-2 sm:grid-cols-2"><Select label="Primary" value={resp.primary} options={[...RESPONSIBILITY_PARTIES, ...RESPONSIBILITY_STANDALONE]} onChange={(primary) => setResp({ ...resp, primary })} /><Text label="Notes" value={resp.notes} onChange={(notes) => setResp({ ...resp, notes })} /></div>
            {RESPONSIBILITY_PARTIES.includes(resp.primary as never) ? <div className="flex flex-wrap gap-1.5">{RESPONSIBILITY_PARTIES.filter((party) => party !== resp.primary).map((party) => <label key={party} className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px]"><input type="checkbox" className="size-3 accent-primary" checked={resp.contributing.includes(party)} onChange={() => setResp({ ...resp, contributing: resp.contributing.includes(party) ? resp.contributing.filter((item) => item !== party) : [...resp.contributing, party] })} />Contributing: {human(party)}</label>)}</div> : null}
            <Submit disabled={!resp.primary} onClick={() => act("Recorded Collision responsibility.", (store) => recordPerformanceDetermination(store, { investigationId: active.id, assessment: RESPONSIBILITY_PARTIES.includes(resp.primary as never) ? { subject: "RESPONSIBILITY", parties: [{ party: resp.primary as never, role: "PRIMARY" }, ...resp.contributing.map((party) => ({ party: party as never, role: "CONTRIBUTING" as const }))], notes: resp.notes.trim() || undefined, catalogueVersion: RESPONSIBILITY_CATALOGUE_VERSION } : { subject: "RESPONSIBILITY", standalone: resp.primary as never, notes: resp.notes.trim() || undefined, catalogueVersion: RESPONSIBILITY_CATALOGUE_VERSION }, determinedBy: by, determinationDate: today() }))}>Record responsibility</Submit>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-background p-3">
            <div className="text-[11px] font-bold">Root cause{rootCauses.length ? ` (${rootCauses.length} recorded)` : ""}</div>
            <div className="grid gap-2 sm:grid-cols-3"><Text label="Category" value={root.category} onChange={(category) => setRoot({ ...root, category })} /><Select label="Status" value={root.status} options={ROOT_CAUSE_STATUSES} onChange={(status) => setRoot({ ...root, status })} /><Text label="Finding" value={root.finding} onChange={(finding) => setRoot({ ...root, finding })} /></div>
            <Submit disabled={!root.category.trim() || !root.status} onClick={() => act("Recorded Collision root cause.", (store) => recordPerformanceDetermination(store, { investigationId: active.id, assessment: { subject: "ROOT_CAUSE", category: root.category.trim(), finding: root.finding.trim() || undefined, status: root.status as never, role: "PRIMARY" }, determinedBy: by, determinationDate: today() }))}>Record root cause</Submit>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-background p-3">
            <div className="flex items-center justify-between"><div className="text-[11px] font-bold">Contributing factors</div><Submit onClick={() => setFactors([...factors, { domain: "", factor: "", role: factors.some((item) => item.role === "PRIMARY") ? "SECONDARY" : "PRIMARY" }])}>Add factor</Submit></div>
            {factors.map((item, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
                <Select label="Domain" value={item.domain} options={CONTRIBUTING_FACTOR_DOMAINS} onChange={(domain) => setFactors(factors.map((row, i) => (i === index ? { ...row, domain } : row)))} />
                <Text label="Factor" value={item.factor} onChange={(factor) => setFactors(factors.map((row, i) => (i === index ? { ...row, factor } : row)))} />
                <button type="button" className="self-end text-[10px] font-bold text-destructive" onClick={() => setFactors(factors.filter((_, i) => i !== index))}>Remove</button>
              </div>
            ))}
            <Submit disabled={!factors.length} onClick={() => act("Recorded Collision contributing factors.", (store) => setInvestigationContributingFactors(store, active.id, factors.map((item) => ({ domain: item.domain as ContributingFactorDomain, factor: item.factor, role: item.role })), { by }))}>Save factors</Submit>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-background p-3 lg:col-span-2">
            <div className="text-[11px] font-bold">Conclusion</div>
            <Text label="Summary" rows={3} value={summary || active.conclusion?.summary || ""} onChange={setSummary} />
            <Submit disabled={!summary.trim()} onClick={() => act("Recorded Collision investigation conclusion.", (store) => updatePerformanceInvestigation(store, active.id, { by, conclusion: { summary: summary.trim() } }))}>Save conclusion</Submit>
          </div>
        </div>
      ) : null}
    </div>
  );
}
