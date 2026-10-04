"use client";

import React from "react";
import {
  CE_ACCESS_CLASSES, CE_BEHAVIOR_CATEGORIES, CE_CAPACITIES, CE_CERTAINTIES, CE_CLAIM_SOURCES, CE_CLAIM_TYPES, CE_COMPLAINT_CATEGORIES, CE_IDENTIFICATION_CERTAINTIES, CE_OCCURRENCE_PRECISIONS, CE_PERSON_TYPES,
  CE_POSITIVE_BEHAVIORS, CE_RECOGNITION_CATEGORIES, CE_RECOGNITION_LEVELS, CE_RECOGNITION_SOURCES, CE_RESPONSE_ACTIONS, CE_SITE_CONDITION_CATEGORIES, CE_SUBTYPES, CE_YES_NO_UNKNOWN, customerOptionLabel, type CustomerOption,
} from "@/lib/performance-customer-event-taxonomy";
import {
  CE_RESPONSE_FACT_KEYS, emptyCustomerBehavior, emptyCustomerClaim, emptyCustomerCommendation, emptyCustomerCondition, emptyCustomerParty, emptyCustomerStatement, emptyCustomerStep, idsFromFact, idsToFact,
  type CustomerDraft,
} from "@/lib/performance-customer-event";

const inputClass = "mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";
const sectionClass = "space-y-3 rounded-xl border border-border bg-muted/10 p-4";
const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

type Update = (updater: (draft: CustomerDraft) => CustomerDraft) => void;
export interface CustomerEvidenceChoice { id: string; label: string }

function Pick({ label, value, options, onChange, required, className = "" }: { label: string; value: string; options: readonly CustomerOption[]; onChange: (value: string) => void; required?: boolean; className?: string }) {
  return <label className={`block min-w-0 text-[11px] font-semibold text-foreground ${className}`}>{label}{required ? <span className="text-destructive"> *</span> : null}<select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}><option value="">Select...</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
function Txt({ label, value, onChange, type = "text", required, className = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; className?: string }) {
  return <label className={`block min-w-0 text-[11px] font-semibold text-foreground ${className}`}>{label}{required ? <span className="text-destructive"> *</span> : null}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} /></label>;
}
function Area({ label, value, onChange, required, className = "" }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; className?: string }) {
  return <label className={`block min-w-0 text-[11px] font-semibold text-foreground ${className}`}>{label}{required ? <span className="text-destructive"> *</span> : null}<textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} /></label>;
}
function Checks({ legend, options, selected, onChange, disabledValue }: { legend: string; options: readonly CustomerOption[]; selected: string[]; onChange: (values: string[]) => void; disabledValue?: string }) {
  return <fieldset className="min-w-0 text-[11px] font-semibold text-foreground"><legend>{legend}</legend><div className="mt-1 flex flex-wrap gap-1.5">{options.filter((option) => option.value !== disabledValue).map((option) => <label key={option.value} className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] ${selected.includes(option.value) ? "border-primary bg-primary/5" : "border-border bg-background"}`}><input type="checkbox" className="size-3.5 accent-primary" checked={selected.includes(option.value)} onChange={() => onChange(toggle(selected, option.value))} />{option.label}</label>)}</div></fieldset>;
}
const Header = ({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) => <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h5 className="text-xs font-bold text-foreground">{title}</h5>{hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}</div>{action}</div>;
const addButton = (label: string, onClick: () => void, testId?: string) => <button type="button" data-testid={testId} onClick={onClick} className="rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-bold hover:bg-muted">{label}</button>;
const removeButton = (onClick: () => void) => <button type="button" onClick={onClick} className="justify-self-end text-[10px] font-bold text-destructive hover:underline">Remove</button>;
const Empty = ({ text }: { text: string }) => <p className="rounded-lg border border-dashed border-border p-2.5 text-[11px] text-muted-foreground">{text}</p>;
const card = "space-y-2 rounded-lg border border-border bg-background p-2.5";
const grid = (cols = "sm:grid-cols-2 lg:grid-cols-4") => `grid gap-2 ${cols}`;
const fieldGrid = (keys: readonly string[], renderField: (key: string) => React.ReactNode, className = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3") => <div className={className}>{keys.map((key) => <React.Fragment key={key}>{renderField(key)}</React.Fragment>)}</div>;
const partyName = (draft: CustomerDraft, id: string) => { const index = draft.parties.findIndex((party) => party.itemId === id); const party = draft.parties[index]; return party ? party.name || customerOptionLabel(CE_PERSON_TYPES, party.personType) || `Party ${index + 1}` : ""; };
const partyOptions = (draft: CustomerDraft): CustomerOption[] => draft.parties.map((party, index) => ({ value: party.itemId, label: party.name || customerOptionLabel(CE_PERSON_TYPES, party.personType) || `Party ${index + 1}` }));

/** Subtype, intake channel, precision, estimated window, discovery, received time and time zone. Derived delays are never stored. */
export function CustomerEventOccurrenceExtras({ draft, update, facts, setFact, renderField }: { draft: CustomerDraft; update: Update; facts: Record<string, unknown>; setFact: (key: string, value: string | null) => void; renderField: (key: string) => React.ReactNode }) {
  const val = (key: string) => (typeof facts[key] === "string" ? (facts[key] as string) : "");
  return (
    <div className={sectionClass} data-testid="ce-occurrence-extras">
      <Header title="Customer Event type, channel and clocks" hint="Choose the type first - it cannot be changed after saving. The occurrence and the time the feedback was received are separate; an exact time is never assumed." />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Pick label="Customer Event type" required value={val("customerEventType")} options={CE_SUBTYPES} onChange={(value) => setFact("customerEventType", value || null)} />
        {renderField("intakeChannel")}
        <Pick label="Occurrence precision" required value={draft.precision} options={CE_OCCURRENCE_PRECISIONS} onChange={(precision) => update((d) => ({ ...d, precision }))} />
        {renderField("eventTimeZone")}
        <Txt label="Estimated window - start" type="datetime-local" value={val("occurrenceWindowStart")} onChange={(v) => setFact("occurrenceWindowStart", v || null)} />
        <Txt label="Estimated window - end" type="datetime-local" value={val("occurrenceWindowEnd")} onChange={(v) => setFact("occurrenceWindowEnd", v || null)} />
        <Txt label="Basis for the window" value={val("occurrenceWindowBasis")} onChange={(v) => setFact("occurrenceWindowBasis", v || null)} />
        <Txt label="Discovery date" type="date" value={val("discoveryDate")} onChange={(v) => setFact("discoveryDate", v || null)} />
        <Txt label="Discovery time" type="time" value={val("discoveryTime")} onChange={(v) => setFact("discoveryTime", v || null)} />
        <Txt label="Received time" type="time" value={val("reportedTime")} onChange={(v) => setFact("reportedTime", v || null)} />
      </div>
    </div>
  );
}

function PartyEditor({ draft, update }: { draft: CustomerDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<CustomerDraft["parties"][number]>) => update((d) => ({ ...d, parties: d.parties.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  return (
    <div className={sectionClass} data-testid="ce-parties">
      <Header title="People & parties" hint="Who reported, who observed, who is the subject, who is recognized. The observer and the subject are different roles. The owning driver is a party like any other and is not assumed responsible." action={<div className="flex gap-1.5">{addButton("Add party", () => update((d) => ({ ...d, parties: [...d.parties, emptyCustomerParty()] })), "ce-add-party")}{addButton("Add owning driver", () => update((d) => (d.parties.some((p) => p.isOwningDriver) ? d : { ...d, parties: [...d.parties, { ...emptyCustomerParty(), personType: "CARRIER_DRIVER", isOwningDriver: true }] })), "ce-add-owning-driver")}</div>} />
      {draft.parties.length === 0 ? <Empty text="No parties recorded. You can add them now or later." /> : draft.parties.map((party, index) => (
        <div key={party.itemId} className={card}>
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold">Party {index + 1}{party.isOwningDriver ? " (owning driver)" : ""}</span>{removeButton(() => update((d) => ({ ...d, parties: d.parties.filter((entry) => entry.itemId !== party.itemId), statements: d.statements.map((s) => (s.providedByPartyId === party.itemId ? { ...s, providedByPartyId: "" } : s)), behaviors: d.behaviors.map((b) => (b.subjectPartyId === party.itemId ? { ...b, subjectPartyId: "" } : b)), commendation: d.commendation && d.commendation.recognizedPartyId === party.itemId ? { ...d.commendation, recognizedPartyId: "" } : d.commendation })))}</div>
          <Checks legend="Capacities (one person may hold several)" options={CE_CAPACITIES} selected={party.capacities} onChange={(capacities) => patch(party.itemId, { capacities })} />
          <div className={grid()}>
            <Pick label="Person type" value={party.personType} options={CE_PERSON_TYPES} onChange={(personType) => patch(party.itemId, { personType, ...(personType === "CARRIER_DRIVER" ? {} : { isOwningDriver: false }) })} />
            <Txt label="Name (free text)" value={party.name} onChange={(name) => patch(party.itemId, { name })} />
            <Txt label="Organization" value={party.organization} onChange={(organization) => patch(party.itemId, { organization })} />
            <Pick label="Identification" value={party.certainty} options={CE_IDENTIFICATION_CERTAINTIES} onChange={(certainty) => patch(party.itemId, { certainty })} />
            <Pick label="Access classification" value={party.accessClassification} options={CE_ACCESS_CLASSES} onChange={(accessClassification) => patch(party.itemId, { accessClassification })} />
          </div>
          {party.personType === "CARRIER_DRIVER" ? <label className="flex items-center gap-1.5 text-[11px] font-semibold"><input type="checkbox" className="size-3.5 accent-primary" checked={party.isOwningDriver} onChange={(e) => update((d) => ({ ...d, parties: d.parties.map((entry) => (entry.itemId === party.itemId ? { ...entry, isOwningDriver: e.target.checked } : e.target.checked ? { ...entry, isOwningDriver: false } : entry)) }))} />This is the driver who owns this event record</label> : null}
        </div>
      ))}
    </div>
  );
}

function StatementEditor({ draft, update }: { draft: CustomerDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<CustomerDraft["statements"][number]>) => update((d) => ({ ...d, statements: d.statements.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  return (
    <div className={sectionClass} data-testid="ce-statements">
      <Header title="Original statement" hint="The customer's or observer's own wording, kept exactly as given. The normalized description above is TES's neutral summary, and any source email or recording stays in Evidence." action={addButton("Add original statement", () => update((d) => ({ ...d, statements: [...d.statements, emptyCustomerStatement()] })), "ce-add-statement")} />
      {draft.statements.length === 0 ? <Empty text="No original statement recorded." /> : draft.statements.map((statement) => (
        <div key={statement.itemId} className={card}>
          <div className="flex items-center justify-end">{removeButton(() => update((d) => ({ ...d, statements: d.statements.filter((entry) => entry.itemId !== statement.itemId) })))}</div>
          <Area label="Statement text (as stated)" required value={statement.text} onChange={(text) => patch(statement.itemId, { text })} />
          <div className={grid("sm:grid-cols-2")}>
            <Pick label="Provided by" value={statement.providedByPartyId} options={partyOptions(draft)} onChange={(providedByPartyId) => patch(statement.itemId, { providedByPartyId })} />
            <Pick label="Access classification" required value={statement.accessClassification} options={CE_ACCESS_CLASSES} onChange={(accessClassification) => patch(statement.itemId, { accessClassification })} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ClaimEditor({ draft, update }: { draft: CustomerDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<CustomerDraft["claims"][number]>) => update((d) => ({ ...d, claims: d.claims.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  return (
    <div className={sectionClass} data-testid="ce-claims">
      <Header title="Reported allegations" hint="What the customer said happened. Every claim is recorded as reported - confirmed facts come only from an investigation." action={addButton("Add allegation", () => update((d) => ({ ...d, claims: [...d.claims, emptyCustomerClaim()] })), "ce-add-claim")} />
      {draft.claims.length === 0 ? <Empty text="No allegations recorded." /> : draft.claims.map((claim, index) => (
        <div key={claim.itemId} className={card}>
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold">Allegation {index + 1} <span className="font-normal text-muted-foreground">- reported, not established</span></span>{removeButton(() => update((d) => ({ ...d, claims: d.claims.filter((entry) => entry.itemId !== claim.itemId) })))}</div>
          <div className={grid("sm:grid-cols-2")}>
            <Pick label="Allegation type" required value={claim.claimType} options={CE_CLAIM_TYPES} onChange={(claimType) => patch(claim.itemId, { claimType })} />
            <Pick label="Reported by" value={claim.source} options={CE_CLAIM_SOURCES} onChange={(source) => patch(claim.itemId, { source })} />
            <Txt label="Reported statement (quote)" value={claim.reportedStatement} onChange={(reportedStatement) => patch(claim.itemId, { reportedStatement })} className="sm:col-span-2" />
            <Txt label="Reported issue / behavior" value={claim.reportedIssue} onChange={(reportedIssue) => patch(claim.itemId, { reportedIssue })} className="sm:col-span-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CommendationEditor({ draft, update }: { draft: CustomerDraft; update: Update }) {
  const commendation = draft.commendation;
  const patch = (change: Partial<NonNullable<CustomerDraft["commendation"]>>) => update((d) => ({ ...d, commendation: d.commendation ? { ...d.commendation, ...change } : d.commendation }));
  return (
    <div className={sectionClass} data-testid="ce-commendation">
      <Header title="Commendation" hint="A positive customer signal in its own right. It does not offset complaints, change safety measures or require an investigation." action={commendation ? removeButton(() => update((d) => ({ ...d, commendation: null }))) : addButton("Add commendation details", () => update((d) => ({ ...d, commendation: emptyCustomerCommendation() })), "ce-add-commendation")} />
      {!commendation ? <Empty text="No commendation details recorded." /> : (
        <div className="space-y-2">
          <div className={grid()}>
            <Pick label="Recognized party" required value={commendation.recognizedPartyId} options={partyOptions(draft)} onChange={(recognizedPartyId) => patch({ recognizedPartyId })} />
            <Pick label="Recognition category" value={commendation.recognitionCategory} options={CE_RECOGNITION_CATEGORIES} onChange={(recognitionCategory) => patch({ recognitionCategory })} />
            <Pick label="Recognition source" value={commendation.recognitionSource} options={CE_RECOGNITION_SOURCES} onChange={(recognitionSource) => patch({ recognitionSource })} />
            <Pick label="Recognition level" value={commendation.recognitionLevel} options={CE_RECOGNITION_LEVELS} onChange={(recognitionLevel) => patch({ recognitionLevel })} />
            <Pick label="Positive behavior" value={commendation.positiveBehaviorCategory} options={CE_POSITIVE_BEHAVIORS} onChange={(positiveBehaviorCategory) => patch({ positiveBehaviorCategory })} />
            <Pick label="Share / testimonial consent" value={commendation.shareConsent} options={CE_YES_NO_UNKNOWN} onChange={(shareConsent) => patch({ shareConsent })} />
            <Txt label="Recognition action taken" value={commendation.recognitionAction} onChange={(recognitionAction) => patch({ recognitionAction })} className="sm:col-span-2" />
          </div>
          <Area label="What was done well (description)" value={commendation.positiveBehaviorDescription} onChange={(positiveBehaviorDescription) => patch({ positiveBehaviorDescription })} />
          <Txt label="Business / relationship impact (factual)" value={commendation.businessImpactNote} onChange={(businessImpactNote) => patch({ businessImpactNote })} />
        </div>
      )}
    </div>
  );
}

function BehaviorEditor({ draft, update }: { draft: CustomerDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<CustomerDraft["behaviors"][number]>) => update((d) => ({ ...d, behaviors: d.behaviors.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  return (
    <div className={sectionClass} data-testid="ce-behaviors">
      <Header title="Person behavior observed" hint="What a person did, as observed or reported. The subject is the person the observation is about - it implies no fault. Add the observer as a party with the Observer capacity." action={addButton("Add person behavior", () => update((d) => ({ ...d, behaviors: [...d.behaviors, emptyCustomerBehavior()] })), "ce-add-behavior")} />
      {draft.behaviors.length === 0 ? <Empty text="No person behavior recorded." /> : draft.behaviors.map((behavior, index) => (
        <div key={behavior.itemId} className={card}>
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold">Observation {index + 1}</span>{removeButton(() => update((d) => ({ ...d, behaviors: d.behaviors.filter((entry) => entry.itemId !== behavior.itemId) })))}</div>
          <div className={grid()}>
            <Pick label="Subject of the observation" required value={behavior.subjectPartyId} options={partyOptions(draft)} onChange={(subjectPartyId) => patch(behavior.itemId, { subjectPartyId })} />
            <Pick label="Primary behavior category" value={behavior.primaryCategory} options={CE_BEHAVIOR_CATEGORIES} onChange={(primaryCategory) => patch(behavior.itemId, { primaryCategory, secondaryCategories: behavior.secondaryCategories.filter((value) => value !== primaryCategory) })} />
            <Pick label="Certainty" value={behavior.certainty} options={CE_CERTAINTIES} onChange={(certainty) => patch(behavior.itemId, { certainty })} />
            <Txt label="What was observed" required value={behavior.description} onChange={(description) => patch(behavior.itemId, { description })} className="sm:col-span-2 lg:col-span-4" />
          </div>
          <details><summary className="cursor-pointer text-[10px] font-bold text-muted-foreground">Secondary behavior categories</summary><div className="mt-2"><Checks legend="Secondary categories" options={CE_BEHAVIOR_CATEGORIES} selected={behavior.secondaryCategories} disabledValue={behavior.primaryCategory} onChange={(secondaryCategories) => patch(behavior.itemId, { secondaryCategories })} /></div></details>
        </div>
      ))}
    </div>
  );
}

function ConditionEditor({ draft, update }: { draft: CustomerDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<CustomerDraft["conditions"][number]>) => update((d) => ({ ...d, conditions: d.conditions.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  return (
    <div className={sectionClass} data-testid="ce-conditions">
      <Header title="Site condition" hint="A condition of the site, separate from anyone's behavior. A condition assigns no responsibility." action={addButton("Add site condition", () => update((d) => ({ ...d, conditions: [...d.conditions, emptyCustomerCondition()] })), "ce-add-condition")} />
      {draft.conditions.length === 0 ? <Empty text="No site condition recorded." /> : draft.conditions.map((condition, index) => (
        <div key={condition.itemId} className={card}>
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold">Condition {index + 1}</span>{removeButton(() => update((d) => ({ ...d, conditions: d.conditions.filter((entry) => entry.itemId !== condition.itemId) })))}</div>
          <div className={grid()}>
            <Pick label="Condition category" required value={condition.category} options={CE_SITE_CONDITION_CATEGORIES} onChange={(category) => patch(condition.itemId, { category })} />
            <Pick label="Certainty" value={condition.certainty} options={CE_CERTAINTIES} onChange={(certainty) => patch(condition.itemId, { certainty })} />
            <Pick label="Immediate risk" value={condition.immediateRisk} options={CE_YES_NO_UNKNOWN} onChange={(immediateRisk) => patch(condition.itemId, { immediateRisk })} />
            <Txt label="Description" required value={condition.description} onChange={(description) => patch(condition.itemId, { description })} className="sm:col-span-2 lg:col-span-4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineEditor({ draft, update }: { draft: CustomerDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<CustomerDraft["steps"][number]>) => update((d) => ({ ...d, steps: d.steps.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  return (
    <div className={sectionClass} data-testid="ce-timeline">
      <Header title="Response timeline" hint="Ordered by the sequence number. Enter actual times; acknowledgement, assignment, investigation and resolution durations are derived later, never entered." action={addButton("Add step", () => update((d) => ({ ...d, steps: [...d.steps, emptyCustomerStep(Math.max(0, ...d.steps.map((entry) => Number(entry.ordinal) || 0)) + 1)] })), "ce-add-step")} />
      {draft.steps.length === 0 ? <Empty text="No response steps recorded." /> : draft.steps.map((entry) => (
        <div key={entry.itemId} className={card}>
          <div className={grid("sm:grid-cols-2 lg:grid-cols-[4.5rem_1.4fr_1.2fr_1fr_auto] lg:items-end")}>
            <Txt label="No." type="number" value={entry.ordinal} onChange={(ordinal) => patch(entry.itemId, { ordinal })} />
            <Pick label="Action" required value={entry.action} options={CE_RESPONSE_ACTIONS} onChange={(action) => patch(entry.itemId, { action, ...(action === "OTHER" ? {} : { actionOther: "" }) })} />
            <Txt label="Date / time" type="datetime-local" value={entry.timestamp} onChange={(timestamp) => patch(entry.itemId, { timestamp })} />
            <Txt label="Actor" value={entry.actor} onChange={(actor) => patch(entry.itemId, { actor })} />
            {removeButton(() => update((d) => ({ ...d, steps: d.steps.filter((item) => item.itemId !== entry.itemId) })))}
          </div>
          <div className={grid("sm:grid-cols-2")}>
            {entry.action === "OTHER" ? <Txt label="Describe the action" required value={entry.actionOther} onChange={(actionOther) => patch(entry.itemId, { actionOther })} /> : null}
            <Txt label="Note" value={entry.note} onChange={(note) => patch(entry.itemId, { note })} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CustomerEventStepPanel({ stepKey, draft, update, facts, setFact, renderField }: {
  stepKey: string; draft: CustomerDraft; update: Update; facts: Record<string, unknown>; setFact: (key: string, value: string | null) => void; renderField: (key: string) => React.ReactNode; companyId: string;
}) {
  const title = (text: string, hint: string) => <div><h4 className="text-sm font-bold text-foreground">{text}</h4><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div>;
  const subtype = typeof facts.customerEventType === "string" ? facts.customerEventType : "";
  if (stepKey === "CE_CUSTOMER") return <section className="space-y-4">{title("Customer & Site", "Free-text references as given. TES has no canonical customer, site or contact records, so no link is created.")}{fieldGrid(["customerName", "customerRole", "customerContact", "customerSite", "siteArea", "shipperName", "receiverName", "brokerName"], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}</section>;
  if (stepKey === "CE_OPERATIONS") return <section className="space-y-4">{title("Shipment & Operations", "Optional references as entered. TES has no canonical shipment, load, trip or dispatch records, so these are free text and no relationship is created.")}{fieldGrid(["loadReference", "shipmentReference", "bolPro", "originText", "destinationText", "appointmentReference", "routeReference", "serviceType", "operatingStage"], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}</section>;
  if (stepKey === "CE_PARTIES") return <section className="space-y-4">{title("People & Parties", "Record who reported, who observed and who the observation is about. Being the owning driver does not mean being the subject or being responsible.")}<PartyEditor draft={draft} update={update} /></section>;
  if (stepKey === "CE_DESCRIPTION") return <section className="space-y-4">{title("Description", "A neutral summary in TES's words, plus the original wording kept separately.")}{fieldGrid(["normalizedNarrative"], renderField, "grid gap-3")}<StatementEditor draft={draft} update={update} /></section>;
  if (stepKey === "CE_SUBTYPE") {
    if (!subtype) return <section className="space-y-4">{title("Subtype Details", "Choose the Customer Event type on the Occurrence step to see its details.")}<Empty text="No Customer Event type chosen yet." /></section>;
    const secondary = idsFromFact(typeof facts.complaintSecondaryCategories === "string" ? facts.complaintSecondaryCategories : "");
    const primary = typeof facts.complaintPrimaryCategory === "string" ? facts.complaintPrimaryCategory : "";
    const requirementKeys = subtype === "COMPLAINT" ? ["complaintAssessmentRequired", "customerResponseRequired"] : subtype === "SITE_BEHAVIOR" ? ["siteReviewRequired", "customerResponseRequired"] : ["recognitionReviewRequired"];
    return (
      <section className="space-y-4">{title(`${customerOptionLabel(CE_SUBTYPES, subtype)} details`, subtype === "COMPLAINT" ? "Classify the complaint and record what was alleged. Nothing here decides whether it is valid." : subtype === "COMMENDATION" ? "Record the positive signal. A commendation never affects complaints or safety measures." : "Record what was observed. An observation is not a violation, and behavior and site condition are kept apart.")}
        {subtype === "COMPLAINT" ? (
          <>
            <div className={sectionClass} data-testid="ce-complaint-category">
              <Header title="Category" hint="Classification only - not cause, responsibility or a violation." />
              <div className="grid gap-3 sm:grid-cols-2">{renderField("complaintPrimaryCategory")}</div>
              <Checks legend="Secondary categories" options={CE_COMPLAINT_CATEGORIES} selected={secondary} disabledValue={primary} onChange={(values) => setFact("complaintSecondaryCategories", idsToFact(values))} />
            </div>
            <ClaimEditor draft={draft} update={update} />
            <div className={sectionClass} data-testid="ce-complaint-impact"><Header title="Impact (as reported)" hint="Raw facts only - not a severity or score." />{fieldGrid(["customerImpactNote", "operationalInterruption", "safetySignificance", "regulatorySignificance"], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}</div>
          </>
        ) : null}
        {subtype === "COMMENDATION" ? <CommendationEditor draft={draft} update={update} /> : null}
        {subtype === "SITE_BEHAVIOR" ? <><BehaviorEditor draft={draft} update={update} /><ConditionEditor draft={draft} update={update} /></> : null}
        <div className={sectionClass} data-testid="ce-requirements"><Header title="Workflow requirements (explicit)" hint="Only what you deliberately require. Nothing is required automatically, and these are never inferred from category, impact or outcome." />{fieldGrid(requirementKeys, renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}</div>
      </section>
    );
  }
  if (stepKey === "CE_RESPONSE") return (
    <section className="space-y-4">{title("Immediate Response", "What was done straight away. These are facts, not resolution or Company Actions; leave blank when not recorded.")}
      <div className={sectionClass} data-testid="ce-response-facts">{fieldGrid([...CE_RESPONSE_FACT_KEYS, "otherImmediateActionNote"], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}</div>
      <TimelineEditor draft={draft} update={update} />
    </section>
  );
  return null;
}

/** Evidence stays on the event once; this block only links existing evidence to child records. */
export function CustomerEventEvidencePanel({ draft, update, evidence }: { draft: CustomerDraft; update: Update; evidence: CustomerEvidenceChoice[] }) {
  const links: Array<{ key: string; label: string; ids: string[]; set: (ids: string[]) => void }> = [
    ...draft.parties.map((item, index) => ({ key: item.itemId, label: `Party: ${partyName(draft, item.itemId) || index + 1}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, parties: d.parties.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.statements.map((item, index) => ({ key: item.itemId, label: `Original statement ${index + 1}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, statements: d.statements.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.claims.map((item) => ({ key: item.itemId, label: `Allegation: ${customerOptionLabel(CE_CLAIM_TYPES, item.claimType) || "Unspecified"}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, claims: d.claims.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...(draft.commendation ? [{ key: "commendation", label: "Commendation", ids: draft.commendation.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, commendation: d.commendation ? { ...d.commendation, evidenceIds: ids } : d.commendation })) }] : []),
    ...draft.behaviors.map((item, index) => ({ key: item.itemId, label: `Person behavior ${index + 1}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, behaviors: d.behaviors.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.conditions.map((item, index) => ({ key: item.itemId, label: `Site condition ${index + 1}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, conditions: d.conditions.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.steps.map((item) => ({ key: item.itemId, label: `Response ${item.ordinal || "?"}: ${customerOptionLabel(CE_RESPONSE_ACTIONS, item.action) || "Unspecified"}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, steps: d.steps.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
  ];
  return (
    <div className={sectionClass} data-testid="ce-evidence-panel">
      <Header title="Evidence references" hint="Evidence is stored once for the Customer Event. Tick the evidence that supports each record; nothing is copied." />
      {evidence.length === 0 ? <Empty text="Add evidence above first, then link it to records here." /> : links.length === 0 ? <Empty text="No records to link yet." /> : (
        <div className="space-y-2">{links.map((link) => (
          <div key={link.key} className="rounded-lg border border-border bg-background p-2"><div className="text-[11px] font-bold">{link.label}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">{evidence.map((item) => <label key={item.id} className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] ${link.ids.includes(item.id) ? "border-primary bg-primary/5" : "border-border"}`}><input type="checkbox" className="size-3 accent-primary" checked={link.ids.includes(item.id)} onChange={() => link.set(toggle(link.ids, item.id))} />{item.label}</label>)}</div></div>
        ))}</div>
      )}
    </div>
  );
}

export function CustomerEventReviewBlock({ draft, facts }: { draft: CustomerDraft; facts: Record<string, unknown> }) {
  const label = (list: readonly CustomerOption[], value: unknown) => customerOptionLabel(list, typeof value === "string" ? value : undefined);
  const row = (name: string, value: string) => <div className="flex justify-between gap-4 text-xs"><span className="text-muted-foreground">{name}</span><span className="text-right font-semibold">{value || "None"}</span></div>;
  return (
    <div className="space-y-2 rounded-xl border border-border p-4" data-testid="ce-review">
      <div className="mb-1 text-xs font-bold">Customer Event Records</div>
      {row("Type", label(CE_SUBTYPES, facts.customerEventType))}
      {row("Occurrence precision", label(CE_OCCURRENCE_PRECISIONS, draft.precision))}
      {row("Parties", draft.parties.map((party, index) => `${partyName(draft, party.itemId) || index + 1}: ${party.capacities.map((value) => label(CE_CAPACITIES, value)).join("/") || "no capacity"}${party.isOwningDriver ? " (owning driver)" : ""}`).join("; "))}
      {row("Original statements", String(draft.statements.length))}
      {row("Reported allegations", String(draft.claims.length))}
      {row("Commendation", draft.commendation ? "Recorded" : "")}
      {row("Person behavior records", String(draft.behaviors.length))}
      {row("Site conditions", String(draft.conditions.length))}
      {row("Response steps", String(draft.steps.length))}
    </div>
  );
}
