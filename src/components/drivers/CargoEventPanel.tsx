"use client";

import React, { useState } from "react";
import type { CompanyDriverStore, DriverEvidenceItem, DriverPerformanceEvent } from "@/types/drivers";
import { appendCargoItemStatusChange, buildCargoSummary, describeCargoIncident, readCargoItems } from "@/lib/performance-cargo";
import { CARGO_ITEM_STATUSES } from "@/lib/performance-cargo-taxonomy";
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
const Section = ({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) => <section data-testid={testId} className="space-y-2 rounded-xl border border-border bg-background p-4"><h5 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h5>{children}</section>;
const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
const Empty = ({ text }: { text: string }) => <p className="text-xs text-muted-foreground">{text}</p>;
const Row = ({ title, lines }: { title: string; lines: Array<string | undefined | false> }) => <div className="rounded-lg border border-border px-3 py-2 text-xs"><div className="font-semibold">{title}</div><div className="text-muted-foreground">{lines.filter(Boolean).join(" · ")}</div></div>;
const GAP = { GAP: "Control gap (derived)", NO_GAP: "No gap", UNDETERMINED: "Gap not determinable" } as const;
const stamp = (value: string | undefined) => (value ? value.replace("T", " ") : undefined);

const closeCargo = (store: CompanyDriverStore, eventId: string, closedBy: string, note: string) => closePerformanceEventWorkflow(store, eventId, { closedBy, note: note || undefined, providers: getWorkflowProvidersForEventType("Cargo Incident") });

/** Cargo Incident readback: summary, workflow, every child structure with human-readable labels, then the common investigation adapter. */
export function CargoEventPanel({ event, workflow, state, evidence, run }: { event: DriverPerformanceEvent; workflow: DerivedWorkflow; state: PerformanceFoundationState; evidence: DriverEvidenceItem[]; run?: EngineRun }) {
  const d = describeCargoIncident(event);
  const summary = buildCargoSummary(event);
  const closure = latestWorkflowClosure(event as never);
  const [closer, setCloser] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [statusItem, setStatusItem] = useState("");
  const [statusTo, setStatusTo] = useState("");
  const [statusBy, setStatusBy] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);
  const location = [event.location, event.city, event.stateProvince, event.country].filter(Boolean).join(", ");
  const evidenceName = (id: string) => evidence.find((item) => item.id === id)?.fileName || id;
  const items = readCargoItems(event);
  const delays = d.time.delays;
  const delayText = [delays.occurrenceToDiscoveryMinutes !== undefined && `occurrence to discovery ${delays.occurrenceToDiscoveryMinutes} min`, delays.discoveryToReportMinutes !== undefined && `discovery to report ${delays.discoveryToReportMinutes} min`].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4" data-testid="cargo-panel">
      <div className="rounded-xl border border-border bg-muted/20 p-4" data-testid="cargo-summary">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-foreground">{summary.title}</span>
          {summary.familyLine ? <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{summary.familyLine}</span> : null}
          {summary.outcomeLine ? <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-foreground">{summary.outcomeLine}</span> : null}
        </div>
        {summary.contextLine ? <p className="mt-1 text-xs text-muted-foreground">{summary.contextLine}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="cargo-workflow">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Workflow</span>
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${TONE[workflow.state]}`}>{workflowStateLabel(workflow.state)}</span>
          {closure ? <span className="text-[10px] text-muted-foreground">Closed by {closure.closedBy} on {closure.closedAt.slice(0, 10)}{workflow.closureSuperseded ? " (reopened by a later obligation)" : ""}</span> : null}
        </div>
        {workflow.reasons.length ? <div className="mt-2"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reason{workflow.reasons.length > 1 ? "s" : ""}</div><ul className="mt-1 space-y-0.5 text-xs text-foreground">{workflow.reasons.map((reason) => <li key={`${reason.code}-${reason.source.type}-${reason.source.id}`} className="flex gap-1.5"><span aria-hidden>•</span><span>{reason.label}{reason.detail ? <span className="text-muted-foreground"> ({reason.detail})</span> : null}</span></li>)}</ul></div> : null}
        {run && workflow.state === "READY_TO_CLOSE" ? (
          <div className="mt-3 space-y-1" data-testid="cargo-close-form">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input aria-label="Closed by" value={closer} onChange={(e) => setCloser(e.target.value)} placeholder="Your name *" className="rounded-xl border border-border bg-background px-3 py-2 text-xs" />
              <input aria-label="Closure note" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Closure note (optional)" className="rounded-xl border border-border bg-background px-3 py-2 text-xs" />
              <button type="button" onClick={() => { if (!closer.trim()) { setCloseError("Enter your name to close."); return; } try { setCloseError(null); run("Closed Cargo Incident workflow (deliberate).", (store) => closeCargo(store, event.id, closer.trim(), closeNote.trim())); } catch (caught) { setCloseError(caught instanceof Error ? caught.message : "Could not close."); } }} className="rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-700">Close Cargo Incident</button>
            </div>
            {closeError ? <p role="alert" className="text-[11px] text-destructive">{closeError}</p> : null}
          </div>
        ) : null}
      </div>

      <Section title="Occurrence" testId="cargo-occurrence"><Grid>
        <Field label="Date" value={event.eventDate} /><Field label="Time" value={event.eventTime} /><Field label="Precision" value={d.time.precision} />
        {d.time.windowStart ? <Field label="Estimated window" value={`${stamp(d.time.windowStart)} to ${stamp(d.time.windowEnd)}${d.time.windowBasis ? ` (${d.time.windowBasis})` : ""}`} wide /> : null}
        <Field label="Discovery" value={d.time.discovery} /><Field label="Reported" value={d.time.reported} /><Field label="Source" value={event.provenance?.source} />
        <Field label="Location" value={location} wide />
        {delayText ? <Field label="Derived timing" value={delayText} wide /> : null}
      </Grid></Section>

      <Section title="Shipment & Trip (free-text references)" testId="cargo-shipment">{d.shipment.length ? <Grid>{d.shipment.map((row) => <Field key={row.label} label={row.label} value={row.value} />)}</Grid> : <Empty text="No shipment references recorded." />}</Section>

      <Section title="Carrier Context" testId="cargo-carrier-readback"><Grid><Field label="Power Unit" value={d.carrier.powerUnit} /><Field label="Trailer(s)" value={d.carrier.trailers} /><Field label="Custody Stage" value={d.classification.custodyStage} /></Grid></Section>

      <Section title="Incident Classification" testId="cargo-classification"><Grid><Field label="Primary Incident Family" value={d.classification.family} /><Field label="Secondary Classification" value={d.classification.secondary} /><Field label="Reporter Description" value={d.narrative} wide /></Grid></Section>

      <Section title="Cargo Items" testId="cargo-items-readback">
        {d.cargoContext.status || d.cargoContext.description ? <Grid><Field label="Cargo context" value={d.cargoContext.status} /><Field label="General cargo description" value={d.cargoContext.description} /></Grid> : null}
        {d.items.length ? <div className="space-y-1.5">{d.items.map((item) => <Row key={item.id} title={`${item.commodity}${item.code ? ` [${item.code}]` : ""}`} lines={[item.status && `Status: ${item.status}`, item.quantity && `Quantity: ${item.quantity}`, item.affected && `Affected: ${item.affected}`, item.damaged && `Damaged: ${item.damaged}`, item.stolen && `Stolen: ${item.stolen}`, item.recovered && `Recovered: ${item.recovered}`, item.hazmat && `Hazmat: ${item.hazmat}`, item.temperatureSensitive && `Temp-sensitive: ${item.temperatureSensitive}`, item.declared && `Declared: ${item.declared}`, item.insured && `Insured: ${item.insured}`, item.affectedValue && `Affected value: ${item.affectedValue}`, item.notes]} />)}</div> : <Empty text="Detailed cargo items not recorded." />}
        {d.statusHistory.length ? <div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status history</div><ul className="mt-1 space-y-0.5 text-xs">{d.statusHistory.map((entry, index) => <li key={index}>{entry.item}: {entry.from || "not recorded"} → <span className="font-semibold">{entry.to}</span> · {entry.by} · {entry.at.slice(0, 16).replace("T", " ")}{entry.note ? ` · ${entry.note}` : ""}</li>)}</ul></div> : null}
        {run && items.length ? (
          <div className="mt-2 space-y-1" data-testid="cargo-status-form">
            <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
              <select aria-label="Item" value={statusItem} onChange={(e) => setStatusItem(e.target.value)} className="rounded-xl border border-border bg-background px-3 py-2 text-xs"><option value="">Item...</option>{items.map((item) => <option key={item.itemId} value={item.itemId}>{item.commodity}</option>)}</select>
              <select aria-label="New status" value={statusTo} onChange={(e) => setStatusTo(e.target.value)} className="rounded-xl border border-border bg-background px-3 py-2 text-xs"><option value="">New status...</option>{CARGO_ITEM_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select>
              <input aria-label="Changed by" value={statusBy} onChange={(e) => setStatusBy(e.target.value)} placeholder="Your name *" className="rounded-xl border border-border bg-background px-3 py-2 text-xs" />
              <button type="button" disabled={!statusItem || !statusTo || !statusBy.trim()} onClick={() => { try { setStatusError(null); run("Recorded Cargo Item status change (history preserved).", (store) => ({ state: { ...store, events: store.events.map((candidate) => (candidate.id === event.id ? { ...appendCargoItemStatusChange(candidate, { cargoItemId: statusItem, toStatus: statusTo, changedBy: statusBy.trim() }), updatedAt: new Date().toISOString() } : candidate)) } })); } catch (caught) { setStatusError(caught instanceof Error ? caught.message : "Could not record."); } }} className="rounded-xl border border-border bg-background px-3 py-2 text-[11px] font-bold hover:bg-muted disabled:opacity-40">Record status change</button>
            </div>
            {statusError ? <p role="alert" className="text-[11px] text-destructive">{statusError}</p> : null}
          </div>
        ) : null}
      </Section>

      {d.damage ? <Section title="Damage Outcome" testId="cargo-damage-readback"><Grid>
        <Field label="Damage type" value={d.damage.type} /><Field label="Scope" value={d.damage.scope} /><Field label="Discovery point" value={d.damage.discoveryPoint} />
        <Field label="Damage origin" value={d.damage.origin} /><Field label="Disposition" value={d.damage.disposition} /><Field label="Damaged value" value={d.damage.damagedValue} />
        <Field label="Reported / Suspected Cause" value={d.damage.reportedCause} /><Field label="Affected items" value={d.damage.affectedItems.join(", ")} /><Field label="Narrative" value={d.damage.narrative} wide />
      </Grid></Section> : null}

      {d.temperature.length ? <Section title="Temperature / Cold Chain" testId="cargo-temperature-readback"><div className="space-y-1.5">{d.temperature.map((obs, index) => <Row key={obs.id} title={`Observation ${index + 1}${obs.source ? ` - source: ${obs.source}` : ""}`} lines={[obs.setpoint && `Setpoint ${obs.setpoint}`, obs.range && `Actual ${obs.range}`, obs.excursion && `Excursion ${obs.excursion}`, obs.reefer && `Reefer: ${obs.reefer}`, obs.fuel && `Fuel: ${obs.fuel}`, obs.doorOpen && `Door open: ${obs.doorOpen}`, obs.observedAt && stamp(obs.observedAt), obs.note]} />)}</div></Section> : null}

      {d.theft ? <Section title="Theft Outcome" testId="cargo-theft-readback"><Grid>
        <Field label="Status" value={d.theft.status} /><Field label="Method" value={d.theft.method} /><Field label="Target" value={d.theft.target} />
        <Field label="Location type" value={d.theft.locationType} /><Field label="Location risk / context" value={d.theft.locationContext} /><Field label="Time certainty" value={d.theft.timeCertainty} />
        <Field label="Time" value={d.theft.time ? stamp(d.theft.time) : undefined} wide /><Field label="Discovery method" value={d.theft.discoveryMethod} /><Field label="Tracking" value={d.theft.tracking} />
        <Field label="Seal" value={d.theft.seal} /><Field label="Police" value={d.theft.police} /><Field label="Recovery" value={d.theft.recovery} />
        <Field label="Stolen value" value={d.theft.stolenValue} /><Field label="Recovered value" value={d.theft.recoveredValue} /><Field label="Narrative" value={d.theft.narrative} wide />
      </Grid></Section> : null}

      <Section title="Custody Timeline" testId="cargo-custody-readback">
        {d.custody.length ? <ol className="space-y-1.5">{d.custody.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-border px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2"><span className="w-6 shrink-0 font-mono font-bold text-primary">{String(entry.ordinal).padStart(2, "0")}</span><span className="font-semibold">{entry.event || entry.role}</span>{entry.role !== entry.event ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold">{entry.role}</span> : null}{entry.anomaly ? <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">Anomaly: {entry.anomaly}</span> : null}{entry.discrepancy ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Expected differs from observed</span> : null}</div>
            <div className="mt-0.5 text-muted-foreground">{[stamp(entry.timestamp), entry.location, entry.custodian && `Custodian: ${entry.custodian}`, entry.vehicle, entry.items.length ? `Items: ${entry.items.join(", ")}` : "", entry.seal && `Seal: ${entry.seal}`, entry.gps && `GPS: ${entry.gps}`, entry.verification && `Verified by: ${entry.verification}`, entry.expected && `Expected: ${entry.expected}`, entry.observed && `Observed: ${entry.observed}`, entry.exception].filter(Boolean).join(" · ")}</div>
          </li>
        ))}</ol> : <Empty text="No custody records." />}
      </Section>

      <Section title="Security Controls" testId="cargo-controls-readback">
        {d.controls.length ? <div className="space-y-1.5">{d.controls.map((control) => <Row key={control.id} title={`${control.type} - ${GAP[control.gap]}`} lines={[control.expected && `Expected: ${control.expected}`, control.actual && `Actual: ${control.actual}`, control.source && `Source: ${control.source}`, control.note]} />)}</div> : <Empty text="No security controls recorded." />}
      </Section>

      <Section title="Immediate Response" testId="cargo-response-readback">{d.response.length ? <Grid>{d.response.map((row) => <Field key={row.key} label={row.key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())} value={row.value} />)}</Grid> : <Empty text="No immediate-response facts recorded." />}</Section>

      <Section title="Evidence" testId="cargo-evidence-readback"><Field label="Evidence" value={event.evidenceIds.length ? event.evidenceIds.map(evidenceName).join(", ") : null} wide /></Section>

      {run ? <Section title="Investigation & Determinations" testId="cargo-investigation-section"><CollisionInvestigationPanel event={event} state={state} run={run} subject="Cargo Incident" /></Section> : null}
    </div>
  );
}
