"use client";

import React, { useState } from "react";
import type { CompanyDriverStore, DriverEvidenceItem, DriverPerformanceEvent } from "@/types/drivers";
import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE } from "@/lib/driver-performance-schema";
import { buildCollisionSummary, collisionFact, COLLISION_DATA_POINTS, describeCollision } from "@/lib/performance-collision";
import { closePerformanceEventWorkflow, latestWorkflowClosure, type DerivedWorkflow } from "@/lib/performance-workflow";
import { getWorkflowProvidersForEventType } from "@/lib/performance-workflow-registry";
import type { PerformanceFoundationState } from "@/lib/performance-foundation-state";
import { CollisionInvestigationPanel, type EngineRun } from "./CollisionInvestigationPanel";
import { workflowStateLabel } from "./NearMissEventPanel";

const TONE: Record<DerivedWorkflow["state"], string> = {
  NOT_REQUIRED: "bg-muted text-muted-foreground",
  OPEN: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  IN_REVIEW: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  READY_TO_CLOSE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  CLOSED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

function Field({ label, value, wide }: { label: string; value?: string | number | null; wide?: boolean }) {
  const shown = value === undefined || value === null || value === "" ? "" : String(value);
  return <div className={`min-w-0 ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-0.5 whitespace-pre-wrap break-words text-xs font-semibold text-foreground">{shown || <span className="font-normal text-muted-foreground">Not recorded</span>}</div></div>;
}
function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return <section data-testid={testId} className="space-y-2 rounded-xl border border-border bg-background p-4"><h5 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h5>{children}</section>;
}
const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
const Empty = ({ text }: { text: string }) => <p className="text-xs text-muted-foreground">{text}</p>;

/** Collision readback: parent summary, workflow, every child structure with human-readable labels, then the common investigation adapter. Legacy records render safely. */
export function CollisionEventPanel({ event, workflow, state, evidence, run }: {
  event: DriverPerformanceEvent;
  workflow: DerivedWorkflow;
  state: PerformanceFoundationState;
  evidence: DriverEvidenceItem[];
  run?: EngineRun;
}) {
  const description = describeCollision(event);
  const summary = buildCollisionSummary(event);
  const fields = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Collision"].fields;
  const optionLabel = (key: string, dataPointId: string) => {
    const raw = collisionFact(event, dataPointId);
    return typeof raw === "string" ? fields.find((field) => field.key === key)?.options?.find((option) => option.value === raw)?.label || raw : "";
  };
  const speed = collisionFact(event, COLLISION_DATA_POINTS.speed);
  const speedFact = event.structuredEventFacts?.find((fact) => fact.dataPointId === COLLISION_DATA_POINTS.speed);
  const legacy = description.legacyDetails;
  const details = event.collisionDetails;
  const evidenceName = (id: string) => evidence.find((item) => item.id === id)?.fileName || id;
  const location = [event.location, event.city, event.stateProvince, event.country].filter(Boolean).join(", ");
  const power = (event.canonicalLinks || []).filter((link) => link.relationshipKey === "vehicle").map((link) => link.label || link.recordId).join(", ");
  const trailers = (event.canonicalLinks || []).filter((link) => link.relationshipKey === "trailer").map((link) => link.label || link.recordId).join(", ");
  const closure = latestWorkflowClosure(event as never);
  const [closer, setCloser] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const counts = description.injuryCounts;

  return (
    <div className="space-y-4" data-testid="collision-panel">
      <div className="rounded-xl border border-border bg-muted/20 p-4" data-testid="collision-summary">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-foreground">{summary.title}</span>
          {summary.outcomeLine ? <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{summary.outcomeLine}</span> : null}
          {description.legacy ? <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Legacy record</span> : null}
        </div>
        {summary.contextLine ? <p className="mt-1 text-xs text-muted-foreground">{summary.contextLine}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="collision-workflow">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Workflow</span>
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${TONE[workflow.state]}`}>{workflowStateLabel(workflow.state)}</span>
          {closure ? <span className="text-[10px] text-muted-foreground">Closed by {closure.closedBy} on {closure.closedAt.slice(0, 10)}{workflow.closureSuperseded ? " (reopened by a later obligation)" : ""}</span> : null}
        </div>
        {workflow.reasons.length ? (
          <div className="mt-2"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reason{workflow.reasons.length > 1 ? "s" : ""}</div>
            <ul className="mt-1 space-y-0.5 text-xs text-foreground">{workflow.reasons.map((reason) => <li key={`${reason.code}-${reason.source.type}-${reason.source.id}`} className="flex gap-1.5"><span aria-hidden>•</span><span>{reason.label}{reason.detail ? <span className="text-muted-foreground"> ({reason.detail})</span> : null}</span></li>)}</ul></div>
        ) : null}
        {run && workflow.state === "READY_TO_CLOSE" ? <CloseForm closer={closer} setCloser={setCloser} note={closeNote} setNote={setCloseNote} error={closeError} onClose={() => { if (!closer.trim()) { setCloseError("Enter your name to close."); return; } try { setCloseError(null); run("Closed Collision workflow (deliberate).", (store) => closeCollision(store, event.id, closer.trim(), closeNote.trim())); } catch (caught) { setCloseError(caught instanceof Error ? caught.message : "Could not close."); } }} /> : null}
      </div>

      <Section title="Occurrence" testId="collision-occurrence"><Grid>
        <Field label="Date" value={event.eventDate} /><Field label="Time" value={[event.eventTime, description.environment.timeZone].filter(Boolean).join(" ")} /><Field label="Source" value={event.provenance?.source} />
        <Field label="Location" value={location} wide /><Field label="Road / Highway" value={description.environment.roadHighway} /><Field label="Direction of Travel" value={description.environment.direction} />
      </Grid></Section>

      <Section title="Collision Facts" testId="collision-facts">
        {description.legacy ? <Grid><Field label="Collision Configuration (legacy)" value={description.classification.legacyConfiguration} /></Grid> : <Grid>
          <Field label="Collision Type" value={description.classification.type} /><Field label="Manner of Collision" value={description.classification.manner} /><Field label="First Harmful Event" value={description.classification.firstHarmfulEvent} />
          <Field label="Driver Activity" value={description.classification.driverActivity} /><Field label="Driver Action" value={description.classification.driverAction} />
        </Grid>}
        {!description.legacy ? (
          <div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Event Sequence</div>
            {description.sequence.length ? <ol className="mt-1 space-y-0.5 text-xs">{description.sequence.map((step) => <li key={step.ordinal} className="flex gap-2"><span className="w-6 shrink-0 font-mono font-bold text-primary">{String(step.ordinal).padStart(2, "0")}</span><span className="min-w-0 break-words"><span className="font-semibold">{step.event || step.description}</span>{step.event && step.description ? ` - ${step.description}` : ""}{step.evidenceCount ? <span className="text-muted-foreground"> · {step.evidenceCount} evidence</span> : null}</span></li>)}</ol> : <Empty text="No sequence recorded." />}</div>
        ) : null}
      </Section>

      <Section title="Parties & Equipment" testId="collision-parties-readback">
        {description.legacy ? <Grid><Field label="Power Unit" value={power} /><Field label="Other Party / Object (legacy)" value={legacy?.otherParty} /></Grid> : description.parties.length ? (
          <div className="space-y-1.5">{description.parties.map((party) => (
            <div key={party.id} className="rounded-lg border border-border px-3 py-2 text-xs">
              <div className="font-semibold">{party.role}{party.vehicle ? ` - ${party.vehicle}` : ""}{party.type ? ` - ${party.type}` : ""}{party.description ? ` (${party.description})` : ""}{party.identifier ? ` [${party.identifier}]` : ""}</div>
              <div className="text-muted-foreground">Damage: {party.damage || "not recorded"} · Drivability: {party.drivability || "not recorded"} · Tow: {party.tow || "not recorded"}{party.impact ? ` · Impact: ${party.impact}` : ""}{party.speed ? ` · Speed: ${party.speed}` : ""}</div>
            </div>
          ))}</div>
        ) : <Empty text="No parties recorded." />}
        {!description.legacy && trailers ? <Field label="Trailer(s)" value={trailers} /> : null}
      </Section>

      <Section title="Environment & Operations" testId="collision-environment"><Grid>
        <Field label="Weather" value={optionLabel("weather", COLLISION_DATA_POINTS.weather)} /><Field label="Road Surface" value={optionLabel("roadCondition", COLLISION_DATA_POINTS.roadCondition) || details?.roadCondition} /><Field label="Lighting" value={optionLabel("lightCondition", COLLISION_DATA_POINTS.lightCondition) || details?.lightCondition} />
        <Field label="Visibility" value={description.environment.visibility} /><Field label="Traffic" value={description.environment.traffic} /><Field label="Work Zone" value={description.environment.workZone} />
        <Field label="Speed at Occurrence" value={typeof speed === "number" ? `${speed} ${speedFact?.unit || ""}`.trim() : undefined} />
        {description.legacy && details?.weather && !optionLabel("weather", COLLISION_DATA_POINTS.weather) ? <Field label="Weather (legacy record)" value={details.weather} /> : null}
      </Grid></Section>

      <Section title="Immediate Outcomes" testId="collision-outcomes">
        {description.legacy ? <Grid>
          <Field label="Injuries / Fatalities (legacy counts)" value={counts ? `${counts.injured} injured / ${counts.fatalities} fatal` : undefined} /><Field label="Tow-Away (legacy)" value={legacy?.tow} /><Field label="Property Damage (legacy)" value={legacy?.propertyDamage} />
          <Field label="Police Attended (legacy)" value={legacy?.police} /><Field label="Police Report #" value={legacy?.policeReportNumber} /><Field label="Reportability (legacy)" value={legacy?.reportability} /><Field label="Estimated Cost (legacy)" value={legacy?.estimatedCost} />
          <Field label="Downtime (hours)" value={description.outcomes.downtimeHours} />
        </Grid> : <Grid>
          <Field label="Injury Status" value={description.outcomes.injuryStatus} /><Field label="Injured / Fatal (from person records)" value={counts ? `${counts.injured} injured / ${counts.fatalities} fatal` : "No person records"} /><Field label="Police Response" value={description.outcomes.police} />
          <Field label="Police Report / Reference" value={description.outcomes.policeReference} /><Field label="Enforcement" value={description.outcomes.enforcement} /><Field label="Cargo" value={description.outcomes.cargo} />
          <Field label="Hazmat" value={description.outcomes.hazmat} /><Field label="Service Interruption" value={description.outcomes.serviceInterruption} /><Field label="Operational Downtime (hours)" value={description.outcomes.downtimeHours} />
          <Field label="Reportability Determination (manual)" value={description.outcomes.reportability || "Not determined"} />
        </Grid>}
      </Section>

      {!description.legacy ? (
        <Section title="Injured Persons" testId="collision-persons-readback">
          {description.injuredPersons.length ? <div className="space-y-1.5">{description.injuredPersons.map((person, index) => (
            <div key={person.id} className="rounded-lg border border-border px-3 py-2 text-xs">
              <div className="font-semibold">Person {index + 1} - {person.role}{person.name ? ` - ${person.name}` : ""}{person.party ? ` (in ${person.party})` : ""}</div>
              <div className="text-muted-foreground">Severity: {person.severity || "not recorded"} · Transported: {person.transported || "not recorded"} · Treatment: {person.treatment || "not recorded"}{person.facility ? ` · Facility: ${person.facility}` : ""}{person.fatalityDate ? ` · Fatality date: ${person.fatalityDate}` : ""}</div>
              {person.notes ? <div className="mt-0.5 whitespace-pre-wrap">{person.notes}</div> : null}
              {person.accessClass ? <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Access: {person.accessClass}</div> : null}
            </div>
          ))}</div> : <Empty text="No injured persons recorded." />}
        </Section>
      ) : null}

      <Section title="Evidence & Driver Statement" testId="collision-statement-readback">
        {description.legacy ? <Grid><Field label="Driver Statement (legacy)" value={legacy?.driverStatement} wide /><Field label="Investigation Narrative (legacy)" value={legacy?.investigationNarrative} wide />{legacy?.witnessStatements ? <Field label="Witness Statements (legacy)" value={legacy.witnessStatements} wide /> : null}</Grid> : (
          <Grid>
            <Field label="Driver Statement" value={description.statement ? `${description.statement.status}${description.statement.method ? ` - ${description.statement.method}` : ""}${description.statement.date ? ` - ${description.statement.date}` : ""}` : description.statementRequired ? "Required - not yet obtained" : undefined} />
            {description.statement?.content ? <Field label="Statement" value={description.statement.content} wide /> : null}
          </Grid>
        )}
        <Field label="Evidence" value={event.evidenceIds.length ? event.evidenceIds.map(evidenceName).join(", ") : null} wide />
      </Section>

      {run ? <Section title="Investigation & Determinations" testId="collision-investigation-section"><CollisionInvestigationPanel event={event} state={state} run={run} /></Section> : null}
    </div>
  );
}

function CloseForm({ closer, setCloser, note, setNote, error, onClose }: { closer: string; setCloser: (value: string) => void; note: string; setNote: (value: string) => void; error: string | null; onClose: () => void }) {
  return (
    <div className="mt-3 space-y-1" data-testid="collision-close-form">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input aria-label="Closed by" value={closer} onChange={(e) => setCloser(e.target.value)} placeholder="Your name *" className="rounded-xl border border-border bg-background px-3 py-2 text-xs" />
        <input aria-label="Closure note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Closure note (optional)" className="rounded-xl border border-border bg-background px-3 py-2 text-xs" />
        <button type="button" onClick={onClose} className="rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-700">Close Collision</button>
      </div>
      {error ? <p role="alert" className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}

const closeCollision = (store: CompanyDriverStore, eventId: string, closedBy: string, note: string) => closePerformanceEventWorkflow(store, eventId, { closedBy, note: note || undefined, providers: getWorkflowProvidersForEventType("Collision") });
