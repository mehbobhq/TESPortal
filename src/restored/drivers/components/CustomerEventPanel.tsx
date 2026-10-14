"use client";

import React, { useState } from "react";
import type { CompanyDriverStore, DriverEvidenceItem, DriverPerformanceEvent } from "@/types/drivers";
import {
  CE_ACCESS_CLASSES, CE_CAPACITIES, CE_CLAIM_TYPES, CE_COLLECTION_IDS as CID, CE_CURRENCIES, CE_CUSTOMER_ACCEPTANCES, CE_FINANCIAL_BASES, CE_FINANCIAL_KINDS, CE_FINANCIAL_LABELS, CE_PERSON_TYPES, CE_RESOLUTION_STATUSES,
  CE_RESPONSE_ACTIONS, CE_REVIEW_TYPES, CE_YES_NO, CE_YES_NO_UNKNOWN, type CustomerOption,
} from "@/lib/performance-customer-event-taxonomy";
import {
  CE_REQUIREMENT_KEYS, buildCustomerEventSummary, describeCustomerEvent, describeLegacyCustomerEvent, isNewTaxonomyCustomerEvent, setCustomerRequirement, upsertCustomerChild,
} from "@/lib/performance-customer-event";
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

type FieldDef = { key: string; label: string; type?: "text" | "datetime-local" | "select"; options?: readonly CustomerOption[] };
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
      <div className="mt-2"><button type="button" onClick={() => { try { setError(null); onSubmit(values); setValues({}); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not record."); } }} className="rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-bold hover:bg-muted">{submitLabel}</button></div>
      {error ? <p role="alert" className="mt-1 text-[11px] text-destructive">{error}</p> : null}
    </details>
  );
}
const need = (values: Record<string, string>, key: string, label: string) => { if (!(values[key] || "").trim()) throw new Error(`${label} is required.`); return values[key].trim(); };
const pickFacts = (values: Record<string, string>, keys: string[]) => Object.fromEntries(keys.filter((key) => (values[key] || "").trim() !== "").map((key) => [key, values[key].trim()]));
const closeCustomer = (store: CompanyDriverStore, eventId: string, closedBy: string, note: string) => closePerformanceEventWorkflow(store, eventId, { closedBy, note: note || undefined, providers: getWorkflowProvidersForEventType("Customer Event") });

/** Legacy Customer Complaint / Commendation / Customer-Site Behavior: compatibility readback only. */
export function LegacyCustomerEventPanel({ event }: { event: DriverPerformanceEvent }) {
  const legacy = describeLegacyCustomerEvent(event as never);
  const title = legacy.kind === "COMPLAINT" ? "Legacy Customer Complaint" : legacy.kind === "COMMENDATION" ? "Legacy Customer Commendation" : "Legacy Customer-Site Behavior";
  return (
    <Section title={`${title} (compatibility readback)`} testId="ce-legacy-readback">
      <p className="text-[11px] text-muted-foreground">Recorded before the structured Customer Event model. Shown as recorded; nothing has been converted into parties, claims, observations or outcome records.</p>
      <Grid>
        <Field label="Customer (as recorded)" value={legacy.customerName} /><Field label="Source" value={legacy.source} />
        {legacy.kind === "COMPLAINT" ? <><Field label="Complaint category (as recorded)" value={legacy.complaintCategory} /><Field label="Received date" value={legacy.receivedDate} /><Field label="Review state (as recorded)" value={legacy.substantiationStatus} /><Field label="Load number" value={legacy.loadNumber} /><Field label="Review notes" value={legacy.reviewNotes} wide /><Field label="Complaint narrative" value={legacy.complaintNarrative} wide /></> : null}
        {legacy.kind === "COMMENDATION" ? <><Field label="Commendation type" value={legacy.commendationType} /><Field label="Recognized by" value={legacy.recognizedBy} /><Field label="Recognition date" value={legacy.recognitionDate} /><Field label="Recognition narrative" value={legacy.recognitionNarrative} wide /></> : null}
        {legacy.kind === "SITE_BEHAVIOR" ? <><Field label="Behavior type (as recorded)" value={legacy.behaviorType} /><Field label="Behavior narrative" value={legacy.behaviorNarrative} wide /></> : null}
      </Grid>
    </Section>
  );
}

/** Customer Event readback: workflow, owning driver's role, parties, statements and allegations as reported, subtype facts, response, resolution, customer outcome, linked events, update forms and the common investigation adapter. */
export function CustomerEventPanel({ event, workflow, state, evidence, run }: { event: DriverPerformanceEvent; workflow: DerivedWorkflow; state: PerformanceFoundationState; evidence: DriverEvidenceItem[]; run?: EngineRun }) {
  const current = isNewTaxonomyCustomerEvent(event);
  const d = describeCustomerEvent(event);
  const summary = buildCustomerEventSummary(event);
  const closure = latestWorkflowClosure(event as never);
  const [closer, setCloser] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [by, setBy] = useState("");
  const [reqField, setReqField] = useState("");
  const [reqTo, setReqTo] = useState("");
  const [reqError, setReqError] = useState<string | null>(null);
  const location = [event.location, event.city, event.stateProvince, event.country].filter(Boolean).join(", ");
  const evidenceName = (id: string) => evidence.find((item) => item.id === id)?.fileName || id;
  const delays = d.time.delays;
  const delayText = [delays.occurrenceToDiscoveryMinutes !== undefined && `occurrence to discovery ${delays.occurrenceToDiscoveryMinutes} min`, delays.discoveryToReceivedMinutes !== undefined && `discovery to received ${delays.discoveryToReceivedMinutes} min`, delays.occurrenceToReceivedMinutes !== undefined && `occurrence to received ${delays.occurrenceToReceivedMinutes} min`].filter(Boolean).join(" · ");
  const relationships = getEventRelationships(state, event.id);
  const eventLabel = (id: string) => state.events.find((item) => item.id === id)?.eventType || id;
  const subtype = d.subtype;
  const applicableRequirements = CE_REQUIREMENT_KEYS.filter((key) => (key === "complaintAssessmentRequired" ? subtype === "COMPLAINT" : key === "customerResponseRequired" ? subtype !== "COMMENDATION" : key === "siteReviewRequired" ? subtype === "SITE_BEHAVIOR" : subtype === "COMMENDATION"));
  const requirementOptions = applicableRequirements.map((key) => ({ value: key, label: key === "complaintAssessmentRequired" ? "Complaint assessment required" : key === "customerResponseRequired" ? "Customer response required" : key === "siteReviewRequired" ? "Site review required" : "Recognition review required" }));
  const reviewTypes = CE_REVIEW_TYPES.filter((type) => (type.value === "SITE" ? subtype === "SITE_BEHAVIOR" : subtype === "COMMENDATION"));

  const write = (description: string, transform: (candidate: DriverPerformanceEvent) => DriverPerformanceEvent) => {
    if (!run) return;
    run(description, (store) => ({ state: { ...store, events: store.events.map((candidate) => (candidate.id === event.id ? { ...transform(candidate), updatedAt: new Date().toISOString() } : candidate)) } }));
  };
  const upsert = (collectionId: string, itemId: string | undefined, values: Record<string, unknown>) => (candidate: DriverPerformanceEvent) => upsertCustomerChild(candidate, { collectionId, itemId, facts: values as Record<string, string | number | null> }).event as DriverPerformanceEvent;

  return (
    <div className="space-y-4" data-testid="ce-panel">
      <div className="rounded-xl border border-border bg-muted/20 p-4" data-testid="ce-summary">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-foreground">{summary.title}</span>
          {current && summary.subtypeLine ? <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{summary.subtypeLine}</span> : null}
          {!current ? <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-foreground" data-testid="ce-legacy-badge">Legacy record</span> : null}
        </div>
        {summary.contextLine ? <p className="mt-1 text-xs text-muted-foreground">{summary.contextLine}</p> : null}
        {current ? <p className="mt-1 text-[11px] text-muted-foreground" data-testid="ce-owning-driver">{d.owningDriver.text}. Owning the record does not imply responsibility.</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="ce-workflow">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Workflow</span>
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${TONE[workflow.state]}`}>{workflowStateLabel(workflow.state)}</span>
          {closure ? <span className="text-[10px] text-muted-foreground">Closed by {closure.closedBy} on {closure.closedAt.slice(0, 10)}{workflow.closureSuperseded ? " (reopened by a later obligation)" : ""}</span> : null}
        </div>
        {workflow.reasons.length ? <div className="mt-2"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reason{workflow.reasons.length > 1 ? "s" : ""}</div><ul className="mt-1 space-y-0.5 text-xs text-foreground">{workflow.reasons.map((reason) => <li key={`${reason.code}-${reason.source.type}-${reason.source.id}`} className="flex gap-1.5"><span aria-hidden>•</span><span>{reason.label}{reason.detail ? <span className="text-muted-foreground"> ({reason.detail})</span> : null}</span></li>)}</ul></div> : null}
        {run && workflow.state === "READY_TO_CLOSE" ? (
          <div className="mt-3 space-y-1" data-testid="ce-close-form">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input aria-label="Closed by" value={closer} onChange={(e) => setCloser(e.target.value)} placeholder="Your name *" className="rounded-xl border border-border bg-background px-3 py-2 text-xs" />
              <input aria-label="Closure note" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Closure note (optional)" className="rounded-xl border border-border bg-background px-3 py-2 text-xs" />
              <button type="button" onClick={() => { if (!closer.trim()) { setCloseError("Enter your name to close."); return; } try { setCloseError(null); run("Closed Customer Event workflow (deliberate).", (store) => closeCustomer(store, event.id, closer.trim(), closeNote.trim())); } catch (caught) { setCloseError(caught instanceof Error ? caught.message : "Could not close."); } }} className="rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-700">Close Customer Event</button>
            </div>
            {closeError ? <p role="alert" className="text-[11px] text-destructive">{closeError}</p> : null}
          </div>
        ) : null}
      </div>

      <Section title="Occurrence and Receipt" testId="ce-occurrence"><Grid>
        <Field label="Occurred (date)" value={event.eventDate} /><Field label="Occurred (time)" value={event.eventTime} /><Field label="Precision" value={d.time.precision} />
        {d.time.windowStart ? <Field label="Estimated window" value={`${stamp(d.time.windowStart)} to ${stamp(d.time.windowEnd)}${d.time.windowBasis ? ` (${d.time.windowBasis})` : ""}`} wide /> : null}
        <Field label="Discovery" value={d.time.discovery} /><Field label="Feedback received" value={d.time.received} /><Field label="Time zone" value={d.time.timeZone} />
        <Field label="Source" value={event.provenance?.source} /><Field label="Intake channel" value={d.intakeChannel} /><Field label="Location" value={location} />
        {delayText ? <Field label="Derived timing" value={delayText} wide /> : null}
      </Grid></Section>

      {!current ? <LegacyCustomerEventPanel event={event} /> : (
        <>
          <Section title="Customer & Site (free-text references)" testId="ce-customer-readback">{d.customer.length ? <Grid>{d.customer.map((row) => <Field key={row.label} label={row.label} value={row.value} />)}</Grid> : <Empty text="No customer or site references recorded." />}</Section>
          <Section title="Shipment & Operations (free-text references)" testId="ce-operations-readback">{d.operations.length ? <Grid>{d.operations.map((row) => <Field key={row.label} label={row.label} value={row.value} />)}</Grid> : <Empty text="No shipment references recorded." />}</Section>

          <Section title="People & Parties" testId="ce-parties-readback">
            {d.parties.length ? <div className="space-y-1.5">{d.parties.map((party) => <Row key={party.id} title={`${party.name || party.personType || "Unnamed party"}${party.owningDriver ? " (owning driver)" : ""}`} badge={party.capacities.join(" / ") || "No capacity"} lines={[party.personType && party.name ? party.personType : undefined, party.organization, party.certainty && `Identification: ${party.certainty}`, party.access && `Access: ${party.access}`]} />)}</div> : <Empty text="No parties recorded." />}
          </Section>

          <Section title="Description" testId="ce-description-readback">
            <Grid><Field label="Event summary" value={d.summary} wide /><Field label="Normalized description" value={d.normalizedNarrative} wide /></Grid>
            {d.statements.length ? <div className="space-y-1.5">{d.statements.map((statement) => <Row key={statement.id} title="Original statement (as stated)" badge={statement.access} lines={[statement.from && `Provided by ${statement.from}`, statement.text]} />)}</div> : <Empty text="No original statement recorded." />}
          </Section>

          {subtype === "COMPLAINT" && d.complaint ? (
            <Section title="Complaint" testId="ce-complaint-readback">
              <Grid><Field label="Primary category (classification only)" value={d.complaint.primaryCategory} /><Field label="Secondary categories" value={d.complaint.secondaryCategories.join(", ")} /></Grid>
              <div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reported allegations</div>
                {d.complaint.claims.length ? <div className="mt-1 space-y-1.5">{d.complaint.claims.map((claim) => <Row key={claim.id} title={`Customer reported: ${claim.type}`} badge={claim.status} lines={[claim.reportedStatement && `"${claim.reportedStatement}"`, claim.reportedIssue, claim.source && `Reported by: ${claim.source}`]} />)}</div> : <p className="mt-1 text-xs text-muted-foreground">No allegations recorded.</p>}
              </div>
              <Grid><Field label="Customer impact (as reported)" value={d.complaint.impact.customerImpactNote} wide /><Field label="Operational interruption / delay" value={d.complaint.impact.operationalInterruption} /><Field label="Safety significance" value={d.complaint.impact.safetySignificance} /><Field label="Regulatory significance" value={d.complaint.impact.regulatorySignificance} /></Grid>
              <p className="text-[11px] text-muted-foreground" data-testid="ce-substantiation-note">Substantiation: recorded only by an investigation determination. Until one is recorded the complaint is pending assessment.</p>
            </Section>
          ) : null}

          {subtype === "COMMENDATION" ? (
            <Section title="Commendation" testId="ce-commendation-readback">
              {d.commendation ? <Grid><Field label="Recognized party" value={d.commendation.recognizedParty} /><Field label="Recognition category" value={d.commendation.category} /><Field label="Recognition source" value={d.commendation.source} /><Field label="Recognition level" value={d.commendation.level} /><Field label="Positive behavior" value={d.commendation.positiveBehavior} /><Field label="Share / testimonial consent" value={d.commendation.shareConsent} /><Field label="What was done well" value={d.commendation.positiveBehaviorDescription} wide /><Field label="Business / relationship impact" value={d.commendation.businessImpactNote} wide /><Field label="Recognition action" value={d.commendation.recognitionAction} wide /></Grid> : <Empty text="No commendation details recorded." />}
            </Section>
          ) : null}

          {subtype === "SITE_BEHAVIOR" ? (
            <>
              <Section title="Person Behavior Observed" testId="ce-behaviors-readback">
                {d.behaviors.length ? <div className="space-y-1.5">{d.behaviors.map((behavior) => <Row key={behavior.id} title={`Subject of observation: ${behavior.subject || "not recorded"}`} badge={behavior.certainty} lines={[behavior.primaryCategory && `Category: ${behavior.primaryCategory}`, behavior.secondaryCategories.length ? `Also: ${behavior.secondaryCategories.join(", ")}` : undefined, behavior.description]} />)}</div> : <Empty text="Observation not yet classified as person behavior." />}
                {d.parties.some((party) => party.capacities.includes("Observer")) ? <p className="text-[11px] text-muted-foreground">Observer: {d.parties.filter((party) => party.capacities.includes("Observer")).map((party) => party.name || party.personType || "unnamed").join(", ")}. The observer and the subject are different roles; a subject is not assumed to be at fault.</p> : null}
              </Section>
              <Section title="Site Condition Observed" testId="ce-conditions-readback">
                {d.conditions.length ? <div className="space-y-1.5">{d.conditions.map((condition) => <Row key={condition.id} title={`Site condition: ${condition.category}`} badge={condition.certainty} lines={[condition.immediateRisk && `Immediate risk: ${condition.immediateRisk}`, condition.description]} />)}</div> : <Empty text="No site condition recorded." />}
              </Section>
            </>
          ) : null}

          <Section title="Immediate Response" testId="ce-response-readback">{d.response.length ? <Grid>{d.response.map((row) => <Field key={row.key} label={row.label} value={row.value} />)}{d.responseNote ? <Field label="Other - note" value={d.responseNote} wide /> : null}</Grid> : <Empty text="No immediate-response facts recorded." />}</Section>

          <Section title="Response Timeline" testId="ce-timeline-readback">
            {d.timeline.length ? <ol className="space-y-1.5">{d.timeline.map((entry) => <li key={entry.id} className="rounded-lg border border-border px-3 py-2 text-xs"><div className="flex flex-wrap items-center gap-2"><span className="w-6 shrink-0 font-mono font-bold text-primary">{String(entry.ordinal).padStart(2, "0")}</span><span className="font-semibold">{entry.action}</span></div><div className="mt-0.5 text-muted-foreground">{[stamp(entry.timestamp), entry.actor && `Actor: ${entry.actor}`, entry.note].filter(Boolean).join(" · ")}</div></li>)}</ol> : <Empty text="No response timeline recorded." />}
            {Object.values(d.responseDelays).some((value) => value !== undefined) ? <p className="text-[11px] text-muted-foreground" data-testid="ce-derived-delays">Derived from the timestamps: {[d.responseDelays.receivedToAcknowledgedMinutes !== undefined && `acknowledged ${minutes(d.responseDelays.receivedToAcknowledgedMinutes)}`, d.responseDelays.receivedToAssignedMinutes !== undefined && `assigned ${minutes(d.responseDelays.receivedToAssignedMinutes)}`, d.responseDelays.receivedToInvestigationStartedMinutes !== undefined && `investigation started ${minutes(d.responseDelays.receivedToInvestigationStartedMinutes)}`, d.responseDelays.receivedToResponseMinutes !== undefined && `response ${minutes(d.responseDelays.receivedToResponseMinutes)}`, d.responseDelays.receivedToResolutionMinutes !== undefined && `resolution ${minutes(d.responseDelays.receivedToResolutionMinutes)}`].filter(Boolean).join(" · ")} after receipt.</p> : null}
          </Section>

          {subtype !== "COMMENDATION" ? (
            <>
              <Section title="Resolution" testId="ce-resolution-readback">{d.resolution ? <Grid><Field label="Resolution status" value={d.resolution.status} /><Field label="Owner" value={d.resolution.owner} /><Field label="Response provided" value={[d.resolution.responseProvided, stamp(d.resolution.responseProvidedAt)].filter(Boolean).join(" - ") || undefined} /><Field label="Resolution provided" value={stamp(d.resolution.resolutionProvidedAt)} /><Field label="Summary" value={d.resolution.summary} wide /></Grid> : <Empty text="No resolution recorded." />}</Section>
              <Section title="Customer Outcome" testId="ce-outcome-readback">{d.outcome ? <Grid><Field label="Customer acceptance (not case closure)" value={d.outcome.acceptance} /><Field label="Customer response received" value={stamp(d.outcome.customerResponseReceivedAt)} /><Field label="Follow-up requested" value={d.outcome.followUpRequested} /><Field label="Outcome note" value={d.outcome.note} wide /></Grid> : <Empty text="No customer outcome recorded." />}{d.chronology.length ? <p className="text-[11px] text-muted-foreground" data-testid="ce-chronology">Combined chronology (read from Resolution and Customer Outcome): {d.chronology.map((row) => `${row.label} ${stamp(row.at)}`).join(" → ")}</p> : null}</Section>
              <Section title="Financial Facts (raw amounts)" testId="ce-financial-readback">{d.financial ? <Grid>{d.financial.rows.map((row) => <Field key={row.kind} label={row.label} value={row.amount} />)}</Grid> : <Empty text="No financial facts recorded." />}</Section>
            </>
          ) : null}

          <Section title="Requirements and Reviews" testId="ce-requirements-readback">
            {d.requirements.length ? <Grid>{d.requirements.map((row) => <Field key={row.key} label={row.label} value={row.value} />)}</Grid> : <Empty text="No explicit requirements recorded." />}
            {d.reviews.length ? <div className="space-y-1.5">{d.reviews.map((review) => <Row key={review.id} title={review.type} lines={[`By ${review.by}`, stamp(review.at), review.note]} />)}</div> : null}
            {d.statusHistory.length ? <ul className="space-y-0.5 text-xs">{d.statusHistory.map((entry, index) => <li key={index}>{entry.field}: {entry.from || "not recorded"} → <span className="font-semibold">{entry.to}</span> · {entry.by} · {entry.at.slice(0, 16).replace("T", " ")}</li>)}</ul> : null}
          </Section>
        </>
      )}

      <Section title="Linked Events" testId="ce-links-readback">
        {relationships.length ? <ul className="space-y-0.5 text-xs">{relationships.map((view) => <li key={view.relationship.id}><span className="font-semibold">{view.effectiveType.replace(/_/g, " ").toLowerCase()}</span> · {eventLabel(view.otherEventId)}{view.relationship.note ? <span className="text-muted-foreground"> · {view.relationship.note}</span> : null}</li>)}</ul> : <Empty text="No linked events." />}
      </Section>

      <Section title="Evidence" testId="ce-evidence-readback"><Field label="Evidence" value={event.evidenceIds.length ? event.evidenceIds.map(evidenceName).join(", ") : null} wide /></Section>

      {run && current ? (
        <Section title="Update Records" testId="ce-enrichment">
          <p className="text-[11px] text-muted-foreground">Record what becomes known. Earlier facts are kept; each change is checked against the whole record. The type of the event cannot be changed.</p>
          {requirementOptions.length ? (
            <div className="grid gap-2 sm:grid-cols-[1.4fr_0.8fr_1fr_auto] sm:items-end" data-testid="ce-requirement-form">
              <label className="block text-[11px] font-semibold">Explicit requirement<select aria-label="Explicit requirement" value={reqField} onChange={(e) => setReqField(e.target.value)} className={inputClass}><option value="">Select...</option>{requirementOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="block text-[11px] font-semibold">Required?<select aria-label="Required?" value={reqTo} onChange={(e) => setReqTo(e.target.value)} className={inputClass}><option value="">Select...</option>{CE_YES_NO.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="block text-[11px] font-semibold">Changed by<input aria-label="Changed by" value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name *" className={inputClass} /></label>
              <button type="button" disabled={!reqField || !reqTo || !by.trim()} onClick={() => { try { setReqError(null); write("Changed a Customer Event requirement (history preserved).", (candidate) => setCustomerRequirement(candidate, { field: reqField as (typeof CE_REQUIREMENT_KEYS)[number], to: reqTo as "YES" | "NO", changedBy: by.trim() }) as DriverPerformanceEvent); } catch (caught) { setReqError(caught instanceof Error ? caught.message : "Could not record."); } }} className="rounded-xl border border-border bg-background px-3 py-2 text-[11px] font-bold hover:bg-muted disabled:opacity-40">Record requirement</button>
            </div>
          ) : null}
          {reqError ? <p role="alert" className="text-[11px] text-destructive">{reqError}</p> : null}
          <EnrichForm title="Add response step" testId="ce-step-form" submitLabel="Add step" fields={[{ key: "action", label: "Action", type: "select", options: CE_RESPONSE_ACTIONS }, { key: "actionOther", label: "Describe (Other)" }, { key: "timestamp", label: "Date / time", type: "datetime-local" }, { key: "actor", label: "Actor" }, { key: "note", label: "Note" }]} onSubmit={(values) => { need(values, "action", "Action"); write("Added Customer Event response step.", upsert(CID.TIMELINE, undefined, pickFacts(values, ["action", "actionOther", "timestamp", "actor", "note"]))); }} />
          {subtype === "COMPLAINT" ? <EnrichForm title="Add reported allegation" testId="ce-claim-form" submitLabel="Add allegation" fields={[{ key: "claimType", label: "Allegation type", type: "select", options: CE_CLAIM_TYPES }, { key: "reportedStatement", label: "Reported statement" }, { key: "reportedIssue", label: "Reported issue" }]} onSubmit={(values) => { need(values, "claimType", "Allegation type"); write("Added a reported allegation.", upsert(CID.CLAIMS, undefined, { source: "CUSTOMER", ...pickFacts(values, ["claimType", "reportedStatement", "reportedIssue"]) })); }} /> : null}
          <EnrichForm title="Add party" testId="ce-party-form" submitLabel="Add party" fields={[{ key: "capacity", label: "Capacity", type: "select", options: CE_CAPACITIES }, { key: "personType", label: "Person type", type: "select", options: CE_PERSON_TYPES }, { key: "name", label: "Name" }, { key: "organization", label: "Organization" }, { key: "accessClassification", label: "Access classification", type: "select", options: CE_ACCESS_CLASSES }]} onSubmit={(values) => { const capacity = need(values, "capacity", "Capacity"); write("Added a Customer Event party.", upsert(CID.PARTIES, undefined, { capacities: capacity, certainty: "IDENTIFIED", ...pickFacts(values, ["personType", "name", "organization", "accessClassification"]) })); }} />
          {subtype !== "COMMENDATION" ? (
            <>
              <EnrichForm title="Record / update resolution" testId="ce-resolution-form" submitLabel="Save resolution" fields={[{ key: "status", label: "Status", type: "select", options: CE_RESOLUTION_STATUSES }, { key: "responseProvided", label: "Response provided", type: "select", options: CE_YES_NO_UNKNOWN }, { key: "summary", label: "Summary" }, { key: "owner", label: "Owner" }, { key: "responseProvidedAt", label: "Response provided", type: "datetime-local" }, { key: "resolutionProvidedAt", label: "Resolution provided", type: "datetime-local" }]} onSubmit={(values) => { write("Recorded Customer Event resolution.", upsert(CID.RESOLUTION, undefined, pickFacts(values, ["status", "responseProvided", "summary", "owner", "responseProvidedAt", "resolutionProvidedAt"]))); }} />
              <EnrichForm title="Record / update customer outcome" testId="ce-outcome-form" submitLabel="Save customer outcome" fields={[{ key: "acceptance", label: "Customer acceptance", type: "select", options: CE_CUSTOMER_ACCEPTANCES }, { key: "customerResponseReceivedAt", label: "Customer response received", type: "datetime-local" }, { key: "followUpRequested", label: "Follow-up requested", type: "select", options: CE_YES_NO_UNKNOWN }, { key: "note", label: "Outcome note" }]} onSubmit={(values) => { write("Recorded Customer Event customer outcome.", upsert(CID.OUTCOME, undefined, pickFacts(values, ["acceptance", "customerResponseReceivedAt", "followUpRequested", "note"]))); }} />
              <EnrichForm title="Record a financial fact" testId="ce-financial-form" submitLabel="Save amount" fields={[{ key: "kind", label: "Type", type: "select", options: CE_FINANCIAL_KINDS.map((kind) => ({ value: kind, label: CE_FINANCIAL_LABELS[kind] })) }, { key: "amount", label: "Amount" }, { key: "currency", label: "Currency", type: "select", options: CE_CURRENCIES }, { key: "basis", label: "Actual or potential", type: "select", options: CE_FINANCIAL_BASES }]} onSubmit={(values) => { const kind = need(values, "kind", "Type"); const amount = Number(need(values, "amount", "Amount")); write("Recorded a Customer Event financial fact.", upsert(CID.FINANCIAL, undefined, { [kind]: amount, [`${kind}Currency`]: values.currency || null, ...(kind === "revenueAtRisk" ? {} : { [`${kind}Basis`]: values.basis || null }) })); }} />
            </>
          ) : null}
          {reviewTypes.length ? <EnrichForm title="Record a completed review" testId="ce-review-form" submitLabel="Record review" fields={[{ key: "reviewType", label: "Review type", type: "select", options: reviewTypes }, { key: "reviewedBy", label: "Reviewed by" }, { key: "reviewedAt", label: "Completed", type: "datetime-local" }, { key: "note", label: "Note" }]} onSubmit={(values) => { need(values, "reviewType", "Review type"); write("Recorded a Customer Event review.", upsert(CID.REVIEWS, undefined, pickFacts(values, ["reviewType", "reviewedBy", "reviewedAt", "note"]))); }} /> : null}
        </Section>
      ) : null}

      {run ? <Section title="Investigation & Determinations" testId="ce-investigation-section"><CollisionInvestigationPanel event={event} state={state} run={run} subject="Customer Event" substantiation={current && subtype === "COMPLAINT"} /></Section> : null}
    </div>
  );
}
