"use client";

import React, { useState } from "react";
import type { DriverEvidenceItem, DriverPerformanceEvent } from "@/types/drivers";
import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE } from "@/lib/driver-performance-schema";
import { buildNearMissSummary, describeNearMiss, getUnsafeConditionState, getUnsafeConditionResolution, NEAR_MISS_DATA_POINTS } from "@/lib/performance-near-miss";
import type { DerivedWorkflow } from "@/lib/performance-workflow";

const WORKFLOW_STATE_LABELS: Record<DerivedWorkflow["state"], string> = { NOT_REQUIRED: "No follow-up required", OPEN: "Open", IN_REVIEW: "In Review", READY_TO_CLOSE: "Ready to Close", CLOSED: "Closed" };
const WORKFLOW_STATE_TONE: Record<DerivedWorkflow["state"], string> = {
  NOT_REQUIRED: "bg-muted text-muted-foreground",
  OPEN: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  IN_REVIEW: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  READY_TO_CLOSE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  CLOSED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

export const workflowStateLabel = (state: DerivedWorkflow["state"]) => WORKFLOW_STATE_LABELS[state];

function Field({ label, value, wide }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap break-words text-xs font-semibold text-foreground">{value || <span className="font-normal text-muted-foreground">Not recorded</span>}</div>
    </div>
  );
}

function Chips({ items, empty = "None recorded" }: { items: string[]; empty?: string }) {
  if (!items.length) return <span className="text-xs font-normal text-muted-foreground">{empty}</span>;
  return <span className="flex flex-wrap gap-1.5">{items.map((item) => <span key={item} className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-semibold text-foreground">{item}</span>)}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2 rounded-xl border border-border bg-background p-4"><h5 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h5><div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div></section>;
}

/** Near Miss saved-event readback: summary hierarchy, workflow state + reasons, then every occurrence fact with human-readable labels. */
export function NearMissEventPanel({ event, workflow, evidence, onResolveUnsafeCondition }: {
  event: DriverPerformanceEvent;
  workflow: DerivedWorkflow;
  evidence: DriverEvidenceItem[];
  onResolveUnsafeCondition?: (input: { resolvedBy: string; note: string; outcome: "RESOLVED" | "CLARIFIED_NO_UNSAFE_CONDITION" }) => void;
}) {
  const description = describeNearMiss(event);
  const summary = buildNearMissSummary(event);
  const fields = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Near Miss"].fields;
  const optionLabel = (key: string, value: unknown) => {
    const raw = typeof value === "string" ? value : "";
    return fields.find((field) => field.key === key)?.options?.find((option) => option.value === raw)?.label || raw;
  };
  const zoneId = fields.find((field) => field.key === "zoneType")?.dataPointId || "";
  const fact = (id: string) => event.structuredEventFacts?.find((item) => item.dataPointId === id)?.value;
  const zone = optionLabel("zoneType", fact(zoneId) ?? event.structuredFacts?.zoneType);
  const context = String(fact(NEAR_MISS_DATA_POINTS.contextNotes) ?? event.structuredFacts?.contextNotes ?? "");
  const linkLabel = (key: string) => (event.canonicalLinks || []).filter((link) => link.relationshipKey === key).map((link) => link.label || link.recordId);
  const unsafe = getUnsafeConditionState(event);
  const canResolve = Boolean(onResolveUnsafeCondition) && (unsafe === "YES" || unsafe === "UNKNOWN") && !getUnsafeConditionResolution(event);
  const [resolver, setResolver] = useState("");
  const [note, setNote] = useState("");
  const location = [event.location, event.city, event.stateProvince, event.country].filter(Boolean).join(", ");

  return (
    <div className="space-y-4" data-testid="near-miss-panel">
      <div className="rounded-xl border border-border bg-muted/20 p-4" data-testid="near-miss-summary">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-foreground">{summary.title}</span>
          {summary.severityLine ? <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{summary.severityLine}</span> : null}
          {description.legacy ? <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Legacy record</span> : null}
        </div>
        {summary.contextLine ? <p className="mt-1 text-xs text-muted-foreground">{summary.contextLine}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="near-miss-workflow">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Workflow</span>
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${WORKFLOW_STATE_TONE[workflow.state]}`}>{WORKFLOW_STATE_LABELS[workflow.state]}</span>
        </div>
        {workflow.reasons.length ? (
          <div className="mt-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reason{workflow.reasons.length > 1 ? "s" : ""}</div>
            <ul className="mt-1 space-y-0.5 text-xs text-foreground">
              {workflow.reasons.map((reason) => (
                <li key={`${reason.code}-${reason.source.type}-${reason.source.id}`} className="flex gap-1.5"><span aria-hidden>•</span><span>{reason.label}{reason.detail ? <span className="text-muted-foreground"> ({reason.detail})</span> : null}</span></li>
              ))}
            </ul>
          </div>
        ) : null}
        {canResolve ? (
          <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); if (!resolver.trim()) return; onResolveUnsafeCondition?.({ resolvedBy: resolver.trim(), note: note.trim(), outcome: unsafe === "UNKNOWN" ? "CLARIFIED_NO_UNSAFE_CONDITION" : "RESOLVED" }); }}>
            <input aria-label="Resolved by" value={resolver} onChange={(e) => setResolver(e.target.value)} placeholder="Your name *" className="rounded-xl border border-border bg-background px-3 py-2 text-xs" />
            <input aria-label="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="rounded-xl border border-border bg-background px-3 py-2 text-xs" />
            <button type="submit" disabled={!resolver.trim()} className="rounded-xl border border-border bg-background px-3 py-2 text-[11px] font-bold hover:bg-muted disabled:opacity-40">{unsafe === "UNKNOWN" ? "Clarify: no unsafe condition" : "Mark unsafe condition resolved"}</button>
          </form>
        ) : null}
      </div>

      <Section title="Occurrence">
        <Field label="Date" value={event.eventDate} />
        <Field label="Time" value={[event.eventTime, description.timeZone].filter(Boolean).join(" ") || null} />
        <Field label="Operating Activity" value={description.operatingActivity} />
        <Field label="Location" value={location} />
        <Field label="Road / Highway" value={description.roadHighway} />
        <Field label="Direction of Travel" value={description.directionOfTravel} />
        <Field label="Zone Type" value={zone || null} />
        <Field label="Power Unit" value={linkLabel("vehicle").join(", ") || null} />
        <Field label="Trailer(s)" value={linkLabel("trailer").join(", ") || null} />
      </Section>

      <Section title="Classification">
        <Field label={description.legacy ? "Near-Miss Configuration (legacy)" : "Primary Near-Miss Type"} value={description.primaryType ? `${description.primaryType}${description.primaryTypeGroup ? ` - ${description.primaryTypeGroup}` : ""}` : null} />
        <div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Secondary Near-Miss Type(s)</div><div className="mt-0.5"><Chips items={description.secondaryTypes} /></div></div>
        <Field label="Other Party / Object" value={[description.otherParty, description.otherPartyDescription].filter(Boolean).join(" - ") || null} />
      </Section>

      <Section title="Potential Outcome">
        <div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Potential Consequences</div><div className="mt-0.5"><Chips items={description.potentialConsequences} />{description.potentialConsequenceOther ? <p className="mt-1 text-xs text-muted-foreground">Other: {description.potentialConsequenceOther}</p> : null}</div></div>
        <Field label="Potential Severity" value={description.severity.effective ? `${description.severity.effective} (${description.severity.effectiveBasis})` : null} />
        <Field label="Reported Potential Severity" value={description.severity.reported || null} />
        <Field label="TES-Assessed Potential Severity" value={description.severity.assessed ? `${description.severity.assessed}${description.severity.assessedBy ? ` - ${description.severity.assessedBy}` : ""}` : "Not yet assessed by TES"} />
      </Section>

      <Section title="Response & Condition">
        <div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Immediate Response</div><div className="mt-0.5"><Chips items={description.immediateResponses} />{description.immediateResponseOther ? <p className="mt-1 text-xs text-muted-foreground">Other: {description.immediateResponseOther}</p> : null}</div></div>
        <Field label="Unsafe Condition Remains" value={description.unsafeCondition || null} />
        {description.unsafeConditionResolution ? <Field label="Unsafe Condition Outcome" value={description.unsafeConditionResolution} /> : null}
      </Section>

      <Section title="Reporter Description">
        <Field label="What the reporter says they observed" value={description.reporterDescription || null} wide />
        {context ? <Field label="Context / Circumstances" value={context} wide /> : null}
        {description.legacyAvoidanceAction ? <Field label="Avoidance Action (legacy)" value={description.legacyAvoidanceAction} wide /> : null}
      </Section>

      <Section title="Source & Evidence">
        <Field label="Source" value={description.source} />
        {description.legacyTriggerSource ? <Field label="Trigger Source (legacy)" value={description.legacyTriggerSource} /> : null}
        <Field label="Evidence" value={event.evidenceIds.length ? event.evidenceIds.map((id) => evidence.find((item) => item.id === id)?.fileName || id).join(", ") : null} />
      </Section>

      {description.measurements.length ? (
        <Section title="Measurements">
          {description.measurements.map((item) => <Field key={item.label} label={item.label} value={item.value} />)}
        </Section>
      ) : null}
    </div>
  );
}
