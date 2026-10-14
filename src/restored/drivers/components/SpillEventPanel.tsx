"use client";

import React, { useState } from "react";
import type { CompanyDriverStore, DriverEvidenceItem, DriverPerformanceEvent } from "@/types/drivers";
import {
  SPILL_ASSESSMENT_STATUSES, SPILL_CLEANUP_STATUSES, SPILL_COLLECTION_IDS as CID, SPILL_EXECUTION_STATUSES, SPILL_IDENTIFICATION_STATUSES, SPILL_MATERIAL_SOURCES, SPILL_PACKING_GROUPS, SPILL_RELEASE_CONDITIONS, SPILL_RELEASE_DETERMINATIONS,
  SPILL_RESPONSE_ACTIONS, SPILL_VERIFICATION_STATUSES, SPILL_YES_NO_UNKNOWN, type SpillOption,
} from "@/lib/performance-spill-taxonomy";
import { buildSpillSummary, describeLegacySpill, describeSpillRelease, isNewTaxonomySpill, readSpillAssessments, readSpillExecutions, readSpillMaterials, setSpillStatus, upsertSpillChild } from "@/lib/performance-spill";
import { closePerformanceEventWorkflow, latestWorkflowClosure, type DerivedWorkflow } from "@/lib/performance-workflow";
import { getEventRelationships } from "@/lib/performance-event-relationships";
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
const inputClass = "mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";

function Field({ label, value, wide }: { label: string; value?: string | number | null; wide?: boolean }) {
  const shown = value === undefined || value === null || value === "" ? "" : String(value);
  return <div className={`min-w-0 ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-0.5 whitespace-pre-wrap break-words text-xs font-semibold text-foreground">{shown || <span className="font-normal text-muted-foreground">Not recorded</span>}</div></div>;
}
const Section = ({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) => <section data-testid={testId} className="space-y-2 rounded-xl border border-border bg-background p-4"><h5 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h5>{children}</section>;
const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
const Empty = ({ text }: { text: string }) => <p className="text-xs text-muted-foreground">{text}</p>;
const Row = ({ title, lines, badge }: { title: string; lines: Array<string | undefined | false>; badge?: string }) => <div className="rounded-lg border border-border px-3 py-2 text-xs"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{title}</span>{badge ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold">{badge}</span> : null}</div><div className="text-muted-foreground">{lines.filter(Boolean).join(" · ")}</div></div>;
const stamp = (value: string | undefined) => (value ? value.replace("T", " ") : undefined);
const minutes = (value: number | undefined) => (value === undefined ? undefined : `${value} min`);

type FieldDef = { key: string; label: string; type?: "text" | "datetime-local" | "select"; options?: readonly SpillOption[] };
/** One compact enrichment form. Values are plain strings; the caller maps them to child facts. */
function EnrichForm({ title, testId, fields, submitLabel, onSubmit }: { title: string; testId: string; fields: FieldDef[]; submitLabel: string; onSubmit: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  return (
    <details className="rounded-lg border border-border bg-muted/10 px-3 py-2" data-testid={testId}>
      <summary className="cursor-pointer text-[11px] font-bold text-foreground">{title}</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((field) => field.type === "select"
          ? <label key={field.key} className="block min-w-0 text-[11px] font-semibold">{field.label}<select aria-label={field.label} value={values[field.key] || ""} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} className={inputClass}><option value="">Select...</option>{(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          : <label key={field.key} className="block min-w-0 text-[11px] font-semibold">{field.label}<input aria-label={field.label} type={field.type || "text"} value={values[field.key] || ""} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} className={inputClass} /></label>)}
      </div>
      <div className="mt-2 flex items-center gap-2"><button type="button" onClick={() => { try { setError(null); onSubmit(values); setValues({}); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not record."); } }} className="rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-bold hover:bg-muted">{submitLabel}</button></div>
      {error ? <p role="alert" className="mt-1 text-[11px] text-destructive">{error}</p> : null}
    </details>
  );
}

const closeSpill = (store: CompanyDriverStore, eventId: string, closedBy: string, note: string) => closePerformanceEventWorkflow(store, eventId, { closedBy, note: note || undefined, providers: getWorkflowProvidersForEventType("Spill or Release") });
const ensure = (values: Record<string, string>, key: string, label: string) => { if (!(values[key] || "").trim()) throw new Error(`${label} is required.`); return values[key].trim(); };
const facts = (values: Record<string, string>, keys: string[]) => Object.fromEntries(keys.filter((key) => (values[key] || "").trim() !== "").map((key) => [key, values[key].trim()]));

/** Spill / Release readback: summary, workflow, every child structure with human-readable labels, downstream enrichment, then the common investigation adapter. Legacy records use compatibility readback. */
export function SpillEventPanel({ event, workflow, state, evidence, run }: { event: DriverPerformanceEvent; workflow: DerivedWorkflow; state: PerformanceFoundationState; evidence: DriverEvidenceItem[]; run?: EngineRun }) {
  const current = isNewTaxonomySpill(event);
  const d = describeSpillRelease(event);
  const legacy = describeLegacySpill(event);
  const summary = buildSpillSummary(event);
  const closure = latestWorkflowClosure(event as never);
  const [closer, setCloser] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [by, setBy] = useState("");
  const [statusField, setStatusField] = useState<"" | "releaseDetermination" | "releaseCondition" | "cleanupStatus">("");
  const [statusTo, setStatusTo] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);
  const location = [event.location, event.city, event.stateProvince, event.country].filter(Boolean).join(", ");
  const evidenceName = (id: string) => evidence.find((item) => item.id === id)?.fileName || id;
  const delays = d.time.delays;
  const delayText = [delays.occurrenceToDiscoveryMinutes !== undefined && `occurrence to discovery ${delays.occurrenceToDiscoveryMinutes} min`, delays.discoveryToReportMinutes !== undefined && `discovery to report ${delays.discoveryToReportMinutes} min`].filter(Boolean).join(" · ");
  const relationships = getEventRelationships(state, event.id);
  const eventLabel = (id: string) => state.events.find((item) => item.id === id)?.eventType || id;
  const statusOptions: Record<string, readonly SpillOption[]> = { releaseDetermination: SPILL_RELEASE_DETERMINATIONS, releaseCondition: SPILL_RELEASE_CONDITIONS, cleanupStatus: SPILL_CLEANUP_STATUSES };
  const materials = readSpillMaterials(event);
  const assessments = readSpillAssessments(event);
  const executions = readSpillExecutions(event);

  /** Every downstream write goes through the pure writers, which re-validate the whole record. */
  const write = (description: string, transform: (candidate: DriverPerformanceEvent) => DriverPerformanceEvent) => {
    if (!run) return;
    run(description, (store) => ({ state: { ...store, events: store.events.map((candidate) => (candidate.id === event.id ? { ...transform(candidate), updatedAt: new Date().toISOString() } : candidate)) } }));
  };
  const upsert = (collectionId: string, itemId: string | undefined, values: Record<string, unknown>) => (candidate: DriverPerformanceEvent) => upsertSpillChild(candidate, { collectionId, itemId, facts: values as Record<string, string | number | null> }).event as DriverPerformanceEvent;

  return (
    <div className="space-y-4" data-testid="spill-panel">
      <div className="rounded-xl border border-border bg-muted/20 p-4" data-testid="spill-summary">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-foreground">{summary.title}</span>
          {current && summary.releaseLine ? <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{summary.releaseLine}</span> : null}
          {!current ? <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-foreground" data-testid="spill-legacy-badge">Legacy record</span> : null}
        </div>
        {current && summary.materialLine ? <p className="mt-1 text-xs font-semibold text-foreground">{summary.materialLine}</p> : null}
        {summary.contextLine ? <p className="mt-1 text-xs text-muted-foreground">{summary.contextLine}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="spill-workflow">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Workflow</span>
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${TONE[workflow.state]}`}>{workflowStateLabel(workflow.state)}</span>
          {closure ? <span className="text-[10px] text-muted-foreground">Closed by {closure.closedBy} on {closure.closedAt.slice(0, 10)}{workflow.closureSuperseded ? " (reopened by a later obligation)" : ""}</span> : null}
        </div>
        {workflow.reasons.length ? <div className="mt-2"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reason{workflow.reasons.length > 1 ? "s" : ""}</div><ul className="mt-1 space-y-0.5 text-xs text-foreground">{workflow.reasons.map((reason) => <li key={`${reason.code}-${reason.source.type}-${reason.source.id}`} className="flex gap-1.5"><span aria-hidden>•</span><span>{reason.label}{reason.detail ? <span className="text-muted-foreground"> ({reason.detail})</span> : null}</span></li>)}</ul></div> : null}
        {run && workflow.state === "READY_TO_CLOSE" ? (
          <div className="mt-3 space-y-1" data-testid="spill-close-form">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input aria-label="Closed by" value={closer} onChange={(e) => setCloser(e.target.value)} placeholder="Your name *" className="rounded-xl border border-border bg-background px-3 py-2 text-xs" />
              <input aria-label="Closure note" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Closure note (optional)" className="rounded-xl border border-border bg-background px-3 py-2 text-xs" />
              <button type="button" onClick={() => { if (!closer.trim()) { setCloseError("Enter your name to close."); return; } try { setCloseError(null); run("Closed Spill / Release workflow (deliberate).", (store) => closeSpill(store, event.id, closer.trim(), closeNote.trim())); } catch (caught) { setCloseError(caught instanceof Error ? caught.message : "Could not close."); } }} className="rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-700">Close Spill / Release</button>
            </div>
            {closeError ? <p role="alert" className="text-[11px] text-destructive">{closeError}</p> : null}
          </div>
        ) : null}
      </div>

      <Section title="Occurrence" testId="spill-occurrence"><Grid>
        <Field label="Date" value={event.eventDate} /><Field label="Time" value={event.eventTime} /><Field label="Precision" value={d.time.precision} />
        {d.time.windowStart ? <Field label="Estimated window" value={`${stamp(d.time.windowStart)} to ${stamp(d.time.windowEnd)}${d.time.windowBasis ? ` (${d.time.windowBasis})` : ""}`} wide /> : null}
        <Field label="Discovery" value={d.time.discovery} /><Field label="Reported" value={d.time.reported} /><Field label="Time zone" value={d.time.timeZone} />
        <Field label="Source" value={event.provenance?.source} /><Field label="Location" value={location} wide />
        {delayText ? <Field label="Derived timing" value={delayText} wide /> : null}
      </Grid></Section>

      {!current ? (
        <Section title="Legacy Spill / Release (compatibility readback)" testId="spill-legacy-readback">
          <p className="text-[11px] text-muted-foreground">Recorded before the structured Spill / Release model. Shown as recorded; nothing has been converted into material, quantity, environmental or release-state records.</p>
          <Grid>
            <Field label="Material / substance (as recorded)" value={legacy.material} /><Field label="Quantity released (as recorded)" value={legacy.quantityReleased} /><Field label="Release environment (as recorded)" value={legacy.releaseEnvironment} />
            <Field label="Containment performed" value={legacy.containmentPerformed} /><Field label="Emergency response" value={legacy.emergencyResponse} /><Field label="Source" value={legacy.source} />
            <Field label="Response narrative" value={legacy.responseNotes} wide />
          </Grid>
        </Section>
      ) : (
        <>
          <Section title="Materials" testId="spill-materials-readback">
            {d.materials.length ? <div className="space-y-1.5">{d.materials.map((material) => <Row key={material.id} title={material.title} badge={material.status ? `Identification: ${material.status}` : "Identification not recorded"} lines={[material.category && `Category: ${material.category}`, material.source && `Source: ${material.source}`, material.physicalState && `State: ${material.physicalState}`, material.properShippingName && `Proper shipping name: ${material.properShippingName}`, material.technicalName && `Technical name: ${material.technicalName}`, material.unId && `UN/ID: ${material.unId}`, material.hazardClass && `Hazard class: ${material.hazardClass}`, material.packingGroup && `Packing group: ${material.packingGroup}`, material.sds && `SDS: ${material.sds}`, material.placardRequired && `Placard required: ${material.placardRequired}`, material.placardDisplayed && `Placard displayed: ${material.placardDisplayed}`, material.shippingPapers && `Shipping papers: ${material.shippingPapers}`, material.notes]} />)}</div> : <Empty text="No material recorded." />}
            {d.materials.some((material) => material.identificationPending) ? <p className="text-[11px] text-muted-foreground" data-testid="spill-identification-pending">Material identification pending.</p> : null}
          </Section>

          <Section title="Release" testId="spill-release-readback"><Grid>
            <Field label="Release determination" value={d.release.determination} /><Field label="Release condition" value={d.release.condition} /><Field label="Cleanup status" value={d.release.cleanupStatus} />
            <Field label="Release form" value={d.release.form} /><Field label="Release mechanism (observed)" value={d.release.mechanism} /><Field label="Release source" value={d.release.sourceCategory} />
            <Field label="Subsystem" value={d.release.subsystem} /><Field label="Component" value={d.release.component} /><Field label="Power Unit" value={d.release.powerUnit} />
            <Field label="Trailer(s)" value={d.release.trailers} /><Field label="Reporter description" value={d.release.narrative} wide />
          </Grid>
            <div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quantities</div>
              {d.quantities.length ? <div className="mt-1 space-y-1.5">{d.quantities.map((quantity) => <Row key={quantity.id} title={`${quantity.type}: ${quantity.amount}`} lines={[quantity.material && `Material: ${quantity.material}`, quantity.status && `Status: ${quantity.status}`, quantity.method && `Method: ${quantity.method}`, quantity.notes]} />)}</div> : <p className="mt-1 text-xs text-muted-foreground">Released quantity not established.</p>}
            </div>
            {d.statusHistory.length ? <div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status history</div><ul className="mt-1 space-y-0.5 text-xs">{d.statusHistory.map((entry, index) => <li key={index}>{entry.field}: {entry.from || "not recorded"} → <span className="font-semibold">{entry.to}</span> · {entry.by} · {entry.at.slice(0, 16).replace("T", " ")}{entry.note ? ` · ${entry.note}` : ""}</li>)}</ul></div> : null}
          </Section>

          <Section title="Shipment & Operations (free-text references)" testId="spill-operations-readback">{d.operations.length ? <Grid>{d.operations.map((row) => <Field key={row.label} label={row.label} value={row.value} />)}</Grid> : <Empty text="No shipment references recorded." />}</Section>

          <Section title="People & Impact" testId="spill-people-readback">
            {d.personCounts ? <div className="flex flex-wrap gap-1.5 text-[11px]" data-testid="spill-person-counts">{[["Recorded", d.personCounts.recorded], ["Exposed", d.personCounts.exposed], ["With symptoms", d.personCounts.withSymptoms], ["Injured", d.personCounts.injured], ["Transported", d.personCounts.transported], ["Hospitalized", d.personCounts.hospitalized], ["Fatalities", d.personCounts.fatalities]].map(([name, value]) => <span key={String(name)} className="rounded-md bg-muted px-2 py-0.5 font-bold">{name}: {value} <span className="font-normal text-muted-foreground">(derived)</span></span>)}</div> : null}
            {d.persons.length ? <div className="space-y-1.5">{d.persons.map((person) => <Row key={person.id} title={`${person.role}${person.name ? ` - ${person.name}` : ""}${person.eventDriver ? " (event driver)" : ""}`} lines={[person.exposure && `Exposure: ${person.exposure}`, person.route && `Route: ${person.route}`, person.symptoms && `Symptoms: ${person.symptoms}`, person.injury && `Injury: ${person.injury}`, person.injuryDescription && `Injury description: ${person.injuryDescription}`, person.firstAid && `First aid: ${person.firstAid}`, person.medical && `Medical: ${person.medical}`, person.transported && `Transported: ${person.transported}`, person.hospitalized && `Hospitalized: ${person.hospitalized}`, person.fatality && `Fatality: ${person.fatality}`, person.access && `Access: ${person.access}`, person.notes]} />)}</div> : <Empty text="No person records." />}
          </Section>

          <Section title="Environmental Impact" testId="spill-environment-readback">
            {d.media.length ? <div className="space-y-1.5">{d.media.map((entry) => <Row key={entry.id} title={entry.medium} badge={entry.status} lines={[entry.note]} />)}</div> : <Empty text="No environmental medium recorded." />}
            {d.risk.length ? <Grid>{d.risk.map((row) => <Field key={row.key} label={`${row.label} (risk, not confirmed impact)`} value={row.value} />)}</Grid> : null}
            {d.otherImpact.facts.length || d.otherImpact.note ? <Grid>{d.otherImpact.facts.map((row) => <Field key={row.key} label={row.label} value={row.value} />)}<Field label="Property / facility impact note" value={d.otherImpact.note} wide /></Grid> : null}
          </Section>

          <Section title="Immediate Response" testId="spill-response-readback">{d.response.length ? <Grid>{d.response.map((row) => <Field key={row.key} label={row.label} value={row.value} />)}</Grid> : <Empty text="No immediate-response facts recorded." />}</Section>

          <Section title="Response Timeline" testId="spill-timeline-readback">
            {d.timeline.length ? <ol className="space-y-1.5">{d.timeline.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-border px-3 py-2 text-xs"><div className="flex flex-wrap items-center gap-2"><span className="w-6 shrink-0 font-mono font-bold text-primary">{String(entry.ordinal).padStart(2, "0")}</span><span className="font-semibold">{entry.action}</span></div><div className="mt-0.5 text-muted-foreground">{[stamp(entry.timestamp), entry.actor && `Actor: ${entry.actor}`, entry.location, entry.source && `Source: ${entry.source}`, entry.notes].filter(Boolean).join(" · ")}</div></li>
            ))}</ol> : <Empty text="No response timeline recorded." />}
            {d.responseDelays.discoveryToEmergencyNotificationMinutes !== undefined || d.responseDelays.discoveryToContainmentMinutes !== undefined || d.responseDelays.cleanupDurationMinutes !== undefined ? <p className="text-[11px] text-muted-foreground" data-testid="spill-derived-delays">Derived from the timestamps: {[d.responseDelays.discoveryToEmergencyNotificationMinutes !== undefined && `discovery to emergency notification ${minutes(d.responseDelays.discoveryToEmergencyNotificationMinutes)}`, d.responseDelays.discoveryToContainmentMinutes !== undefined && `discovery to containment ${minutes(d.responseDelays.discoveryToContainmentMinutes)}`, d.responseDelays.cleanupDurationMinutes !== undefined && `cleanup duration ${minutes(d.responseDelays.cleanupDurationMinutes)}`].filter(Boolean).join(" · ")}</p> : null}
          </Section>

          <Section title="Cleanup" testId="spill-cleanup-readback">
            <Grid><Field label="Cleanup status" value={d.release.cleanupStatus} /></Grid>
            {d.cleanups.length ? <div className="space-y-1.5">{d.cleanups.map((cleanup, index) => <Row key={cleanup.id} title={`Cleanup ${index + 1}${cleanup.vendor ? ` - ${cleanup.vendor}` : ""}`} lines={[cleanup.method, cleanup.started && `Started ${stamp(cleanup.started)}`, cleanup.completed && `Completed ${stamp(cleanup.completed)}`, cleanup.material && `Removed: ${cleanup.material}`, cleanup.removed && `Quantity: ${cleanup.removed}`, cleanup.disposalMethod && `Disposal: ${cleanup.disposalMethod}`, cleanup.manifest && `Manifest: ${cleanup.manifest}`, cleanup.wasteClassification && `Waste classification: ${cleanup.wasteClassification}`, cleanup.restoration && `Restoration: ${cleanup.restoration}`, cleanup.verification && `Verification: ${cleanup.verification}`, cleanup.verificationNote, cleanup.cost && `Cost: ${cleanup.cost}`, cleanup.notes]} />)}</div> : <Empty text="No detailed cleanup record." />}
            {d.financial ? <Grid><Field label="Material value" value={d.financial.materialValue} /><Field label="Cleanup cost" value={d.financial.cleanupCost} /><Field label="Remediation / environmental cost" value={d.financial.remediationCost} /><Field label="Repair cost" value={d.financial.repairCost} /></Grid> : null}
          </Section>

          <Section title="Regulatory Obligations" testId="spill-regulatory-readback">
            {d.regulatory.length ? <div className="space-y-1.5">{d.regulatory.map((entry) => <Row key={entry.id} title={[entry.jurisdiction, entry.authority].filter(Boolean).join(" / ") || "Regulatory obligation"} badge={`Assessment: ${entry.assessment}`} lines={[entry.basis && `Basis: ${entry.basis}`, entry.notificationRequired && `Notification required: ${entry.notificationRequired}`, entry.notificationDeadline && `Notification deadline ${stamp(entry.notificationDeadline)}`, entry.notificationStatus && `Notification: ${entry.notificationStatus}`, entry.notifiedAt && `Notified ${stamp(entry.notifiedAt)}`, entry.reportRequired && `Report required: ${entry.reportRequired}`, entry.reportDeadline && `Report deadline ${stamp(entry.reportDeadline)}`, entry.reportStatus && `Report: ${entry.reportStatus}`, entry.submittedAt && `Submitted ${stamp(entry.submittedAt)}`, entry.reportControlNumber && `Control no.: ${entry.reportControlNumber}`, entry.submissionReference && `Submission: ${entry.submissionReference}`, entry.note]} />)}</div> : <Empty text="Regulatory assessment not recorded." />}
          </Section>
        </>
      )}

      <Section title="Linked Events" testId="spill-links-readback">
        {relationships.length ? <ul className="space-y-0.5 text-xs">{relationships.map((view) => <li key={view.relationship.id}><span className="font-semibold">{view.effectiveType.replace(/_/g, " ").toLowerCase()}</span> · {eventLabel(view.otherEventId)}{view.relationship.note ? <span className="text-muted-foreground"> · {view.relationship.note}</span> : null}</li>)}</ul> : <Empty text="No linked events." />}
      </Section>

      <Section title="Evidence" testId="spill-evidence-readback"><Field label="Evidence" value={event.evidenceIds.length ? event.evidenceIds.map(evidenceName).join(", ") : null} wide /></Section>

      {run && current ? (
        <Section title="Update Records" testId="spill-enrichment">
          <p className="text-[11px] text-muted-foreground">Record what becomes known. Prior values are kept in history; each change is checked against the whole record.</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" data-testid="spill-status-form">
            <label className="block text-[11px] font-semibold">Status to change<select aria-label="Status to change" value={statusField} onChange={(e) => { setStatusField(e.target.value as typeof statusField); setStatusTo(""); }} className={inputClass}><option value="">Select...</option><option value="releaseDetermination">Release determination</option><option value="releaseCondition">Release condition</option><option value="cleanupStatus">Cleanup status</option></select></label>
            <label className="block text-[11px] font-semibold">New value<select aria-label="New value" value={statusTo} disabled={!statusField} onChange={(e) => setStatusTo(e.target.value)} className={inputClass}><option value="">Select...</option>{(statusField ? statusOptions[statusField] : []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="block text-[11px] font-semibold">Changed by<input aria-label="Changed by" value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name *" className={inputClass} /></label>
            <button type="button" disabled={!statusField || !statusTo || !by.trim()} onClick={() => { try { setStatusError(null); write("Changed Spill / Release status (history preserved).", (candidate) => setSpillStatus(candidate, { field: statusField as "releaseDetermination", to: statusTo, changedBy: by.trim() }) as DriverPerformanceEvent); } catch (caught) { setStatusError(caught instanceof Error ? caught.message : "Could not record."); } }} className="rounded-xl border border-border bg-background px-3 py-2 text-[11px] font-bold hover:bg-muted disabled:opacity-40">Record status change</button>
          </div>
          {statusError ? <p role="alert" className="text-[11px] text-destructive">{statusError}</p> : null}
          {materials.length ? <EnrichForm title="Update material identification" testId="spill-material-form" submitLabel="Update material" fields={[{ key: "materialId", label: "Material", type: "select", options: materials.map((material) => ({ value: material.itemId, label: material.description || material.category || material.itemId })) }, { key: "identificationStatus", label: "Identification status", type: "select", options: SPILL_IDENTIFICATION_STATUSES }, { key: "materialSource", label: "Identification source", type: "select", options: SPILL_MATERIAL_SOURCES }, { key: "properShippingName", label: "Proper shipping name" }, { key: "unId", label: "UN / ID" }, { key: "hazardClass", label: "Hazard class / division" }, { key: "packingGroup", label: "Packing group", type: "select", options: SPILL_PACKING_GROUPS }]} onSubmit={(values) => { const id = ensure(values, "materialId", "Material"); write("Updated Spill / Release material identification.", upsert(CID.MATERIALS, id, facts(values, ["identificationStatus", "materialSource", "properShippingName", "unId", "hazardClass", "packingGroup"]))); }} /> : null}
          <EnrichForm title="Add response step" testId="spill-step-form" submitLabel="Add step" fields={[{ key: "action", label: "Action", type: "select", options: SPILL_RESPONSE_ACTIONS }, { key: "actionOther", label: "Describe (Other)" }, { key: "timestamp", label: "Date / time", type: "datetime-local" }, { key: "actor", label: "Actor" }, { key: "location", label: "Location" }]} onSubmit={(values) => { ensure(values, "action", "Action"); write("Added Spill / Release response step.", upsert(CID.RESPONSE_TIMELINE, undefined, facts(values, ["action", "actionOther", "timestamp", "actor", "location"]))); }} />
          <EnrichForm title="Add cleanup record" testId="spill-cleanup-form" submitLabel="Add cleanup record" fields={[{ key: "vendor", label: "Vendor" }, { key: "method", label: "Method" }, { key: "startedAt", label: "Started", type: "datetime-local" }, { key: "completedAt", label: "Completed", type: "datetime-local" }, { key: "disposalMethod", label: "Disposal method" }, { key: "disposalManifest", label: "Disposal manifest / reference" }, { key: "verificationStatus", label: "Verification", type: "select", options: SPILL_VERIFICATION_STATUSES }]} onSubmit={(values) => { write("Added Spill / Release cleanup record.", upsert(CID.CLEANUP, undefined, facts(values, ["vendor", "method", "startedAt", "completedAt", "disposalMethod", "disposalManifest", "verificationStatus"]))); }} />
          <EnrichForm title="Add regulatory obligation" testId="spill-obligation-form" submitLabel="Add obligation" fields={[{ key: "jurisdiction", label: "Jurisdiction" }, { key: "authority", label: "Authority" }, { key: "basis", label: "Basis (as stated)" }, { key: "assessmentStatus", label: "Assessment status", type: "select", options: SPILL_ASSESSMENT_STATUSES }]} onSubmit={(values) => { write("Added Spill / Release regulatory obligation.", upsert(CID.REGULATORY_ASSESSMENTS, undefined, { assessmentStatus: values.assessmentStatus || "NOT_ASSESSED", ...facts(values, ["jurisdiction", "authority", "basis"]) })); }} />
          {assessments.length ? <EnrichForm title="Update regulatory assessment / execution" testId="spill-execution-form" submitLabel="Update obligation" fields={[{ key: "assessmentId", label: "Obligation", type: "select", options: assessments.map((entry) => ({ value: entry.itemId, label: [entry.jurisdiction, entry.authority].filter(Boolean).join(" / ") || entry.itemId })) }, { key: "assessmentStatus", label: "Assessment status", type: "select", options: SPILL_ASSESSMENT_STATUSES }, { key: "notificationRequired", label: "Notification required", type: "select", options: SPILL_YES_NO_UNKNOWN }, { key: "notificationDeadline", label: "Notification deadline", type: "datetime-local" }, { key: "notificationStatus", label: "Notification status", type: "select", options: SPILL_EXECUTION_STATUSES }, { key: "notifiedAt", label: "Notified at", type: "datetime-local" }, { key: "reportRequired", label: "Report required", type: "select", options: SPILL_YES_NO_UNKNOWN }, { key: "reportDeadline", label: "Report deadline", type: "datetime-local" }, { key: "reportStatus", label: "Report status", type: "select", options: SPILL_EXECUTION_STATUSES }, { key: "submittedAt", label: "Submitted at", type: "datetime-local" }, { key: "reportControlNumber", label: "Report / control number" }, { key: "submissionReference", label: "Submission reference" }]} onSubmit={(values) => {
            const id = ensure(values, "assessmentId", "Obligation");
            const executionKeys = ["notificationRequired", "notificationDeadline", "notificationStatus", "notifiedAt", "reportRequired", "reportDeadline", "reportStatus", "submittedAt", "reportControlNumber", "submissionReference"];
            const executionFacts = facts(values, executionKeys);
            const existing = executions.find((entry) => entry.assessmentId === id);
            write("Updated Spill / Release regulatory obligation.", (candidate) => {
              let next = candidate;
              if (values.assessmentStatus) next = upsertSpillChild(next, { collectionId: CID.REGULATORY_ASSESSMENTS, itemId: id, facts: { assessmentStatus: values.assessmentStatus } }).event as DriverPerformanceEvent;
              if (Object.keys(executionFacts).length) next = upsertSpillChild(next, { collectionId: CID.REGULATORY_EXECUTIONS, itemId: existing?.itemId, facts: { assessmentId: id, ...executionFacts } }).event as DriverPerformanceEvent;
              return next;
            });
          }} /> : null}
        </Section>
      ) : null}

      {run ? <Section title="Investigation & Determinations" testId="spill-investigation-section"><CollisionInvestigationPanel event={event} state={state} run={run} subject="Spill / Release" /></Section> : null}
    </div>
  );
}
