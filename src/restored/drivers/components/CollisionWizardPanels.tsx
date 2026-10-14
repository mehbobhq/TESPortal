"use client";

import React from "react";
import {
  COLLISION_ACCESS_CLASSES, COLLISION_DAMAGE_STATUSES, COLLISION_DRIVABILITY, COLLISION_IMPACT_POINTS, COLLISION_INJURY_SEVERITIES, COLLISION_OTHER_PARTY_TYPES, COLLISION_PERSON_ROLES,
  COLLISION_SEQUENCE_EVENTS, COLLISION_SPEED_UNITS, COLLISION_STATEMENT_METHODS, COLLISION_STATEMENT_STATUSES, COLLISION_TOW_STATUSES, COLLISION_TREATMENT_STATUSES, COLLISION_YES_NO_UNKNOWN,
  collisionOptionLabel, type CollisionOption,
} from "@/lib/performance-collision-taxonomy";
import { carrierPartyItemId, emptyUnitDetail, type CollisionDraft, type CollisionDraftUnitDetail } from "@/lib/performance-collision";
import { useNearMissVehicles, type NearMissVehicleChoice } from "./NearMissWizardPanels";

const inputClass = "mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";
const sectionClass = "space-y-3 rounded-xl border border-border bg-muted/10 p-4";
const uid = (prefix: string) => `${prefix}-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 6)}`;
const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

type Update = (updater: (draft: CollisionDraft) => CollisionDraft) => void;
export interface CollisionEvidenceChoice { id: string; label: string }

function Pick({ label, value, options, onChange, required, className = "" }: { label: string; value: string; options: readonly CollisionOption[]; onChange: (value: string) => void; required?: boolean; className?: string }) {
  return (
    <label className={`block min-w-0 text-[11px] font-semibold text-foreground ${className}`}>
      {label}{required ? <span className="text-destructive"> *</span> : null}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}><option value="">Select...</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    </label>
  );
}

function Txt({ label, value, onChange, placeholder, type = "text", className = "" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; className?: string }) {
  return <label className={`block min-w-0 text-[11px] font-semibold text-foreground ${className}`}>{label}<input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} /></label>;
}

function Header({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h5 className="text-xs font-bold text-foreground">{title}</h5>{hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}</div>{action}</div>;
}

const addButton = (label: string, onClick: () => void) => <button type="button" onClick={onClick} className="rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-bold hover:bg-muted">{label}</button>;
const removeButton = (onClick: () => void, label = "Remove") => <button type="button" onClick={onClick} className="justify-self-end text-[10px] font-bold text-destructive hover:underline">{label}</button>;

function UnitFields({ detail, onChange }: { detail: CollisionDraftUnitDetail; onChange: (patch: Partial<CollisionDraftUnitDetail>) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Pick label="Damage" value={detail.damageStatus} options={COLLISION_DAMAGE_STATUSES} onChange={(damageStatus) => onChange({ damageStatus })} />
      <Pick label="Drivability" value={detail.drivability} options={COLLISION_DRIVABILITY} onChange={(drivability) => onChange({ drivability })} />
      <Pick label="Tow" value={detail.towStatus} options={COLLISION_TOW_STATUSES} onChange={(towStatus) => onChange({ towStatus })} />
      <Pick label="Impact" value={detail.impactPoint} options={COLLISION_IMPACT_POINTS} onChange={(impactPoint) => onChange({ impactPoint })} />
      <Txt label="Speed (if known)" type="number" value={detail.speed} onChange={(speed) => onChange({ speed })} />
      <Pick label="Speed unit" value={detail.speedUnit} options={COLLISION_SPEED_UNITS} onChange={(speedUnit) => onChange({ speedUnit })} />
    </div>
  );
}

/** Event Sequence editor: an explicit ordinal is the ordering authority, not array position. */
function SequenceEditor({ draft, update }: { draft: CollisionDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<CollisionDraft["sequence"][number]>) => update((d) => ({ ...d, sequence: d.sequence.map((step) => (step.itemId === itemId ? { ...step, ...change } : step)) }));
  return (
    <div className={sectionClass} data-testid="collision-sequence">
      <Header title="Event Sequence" hint="Optional. What happened, in order. Use the sequence number to order steps." action={addButton("Add step", () => update((d) => ({ ...d, sequence: [...d.sequence, { itemId: uid("CSQ"), ordinal: String(Math.max(0, ...d.sequence.map((step) => Number(step.ordinal) || 0)) + 1), eventValue: "", description: "", notes: "", evidenceIds: [] }] })))} />
      {draft.sequence.length === 0 ? <p className="rounded-lg border border-dashed border-border p-2.5 text-[11px] text-muted-foreground">No steps recorded.</p> : (
        <div className="space-y-2">
          {draft.sequence.map((step) => (
            <div key={step.itemId} className="grid gap-2 rounded-lg border border-border bg-background p-2 sm:grid-cols-[4.5rem_minmax(10rem,1fr)_minmax(12rem,2fr)_auto] sm:items-end">
              <Txt label="No." type="number" value={step.ordinal} onChange={(ordinal) => patch(step.itemId, { ordinal })} />
              <Pick label="Event" value={step.eventValue} options={COLLISION_SEQUENCE_EVENTS} onChange={(eventValue) => patch(step.itemId, { eventValue })} />
              <Txt label="Description / notes" value={step.description} onChange={(description) => patch(step.itemId, { description })} placeholder="Describe this step" />
              {removeButton(() => update((d) => ({ ...d, sequence: d.sequence.filter((item) => item.itemId !== step.itemId) })))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PartiesEditor({ draft, update, vehicles }: { draft: CollisionDraft; update: Update; vehicles: { powerUnits: NearMissVehicleChoice[]; trailers: NearMissVehicleChoice[] } }) {
  const unit = (id: string) => [...vehicles.powerUnits, ...vehicles.trailers].find((vehicle) => vehicle.id === id);
  const patchCarrier = (id: string, change: Partial<CollisionDraftUnitDetail>) => update((d) => ({ ...d, carriers: { ...d.carriers, [id]: { ...(d.carriers[id] || emptyUnitDetail()), ...change } } }));
  const patchOther = (itemId: string, change: Partial<CollisionDraft["others"][number]>) => update((d) => ({ ...d, others: d.others.map((party) => (party.itemId === itemId ? { ...party, ...change } : party)) }));
  const carriers = [draft.powerUnitId, ...draft.trailerIds].filter(Boolean);
  return (
    <div className="space-y-4" data-testid="collision-parties">
      <div className={sectionClass}>
        <Header title="Carrier equipment" hint="Linked to canonical company Vehicles. Nothing is created here." />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] font-semibold text-foreground">Power Unit <span className="text-destructive">*</span>
            <select id="collision-power-unit" value={draft.powerUnitId} onChange={(e) => update((d) => ({ ...d, powerUnitId: e.target.value }))} className={inputClass}>
              <option value="">Select...</option>{vehicles.powerUnits.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>Unit {vehicle.unitNumber}{vehicle.equipmentType ? ` - ${vehicle.equipmentType}` : ""}</option>)}
            </select>
            {vehicles.powerUnits.length === 0 ? <span className="mt-1 block text-[10px] text-destructive">No power units on record for this company.</span> : null}
          </label>
          <fieldset className="min-w-0 text-[11px] font-semibold text-foreground"><legend>Trailer(s) <span className="font-normal text-muted-foreground">(optional)</span></legend>
            <div className="mt-1 flex flex-wrap gap-1.5">{vehicles.trailers.length === 0 ? <span className="text-[10px] font-normal text-muted-foreground">No trailers on record.</span> : vehicles.trailers.map((vehicle) => (
              <label key={vehicle.id} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${draft.trailerIds.includes(vehicle.id) ? "border-primary bg-primary/5" : "border-border bg-background"}`}><input type="checkbox" className="size-3.5 accent-primary" checked={draft.trailerIds.includes(vehicle.id)} onChange={() => update((d) => ({ ...d, trailerIds: toggle(d.trailerIds, vehicle.id) }))} />Unit {vehicle.unitNumber}</label>
            ))}</div>
          </fieldset>
        </div>
        {carriers.map((id) => (
          <div key={id} className="rounded-lg border border-border bg-background p-2.5">
            <div className="mb-1.5 text-[11px] font-bold text-foreground">{id === draft.powerUnitId ? "Power Unit" : "Trailer"} - Unit {unit(id)?.unitNumber || id}</div>
            <UnitFields detail={draft.carriers[id] || emptyUnitDetail()} onChange={(change) => patchCarrier(id, change)} />
          </div>
        ))}
      </div>

      <div className={sectionClass}>
        <Header title="Other vehicles / parties / objects" hint="Event-local records. No driver, vehicle or contact record is created for external parties." action={addButton("Add other party", () => update((d) => ({ ...d, others: [...d.others, { itemId: uid("CPT"), partyType: "", description: "", identifier: "", ...emptyUnitDetail() }] })))} />
        {draft.others.length === 0 ? <p className="rounded-lg border border-dashed border-border p-2.5 text-[11px] text-muted-foreground">None recorded (for example a single-vehicle occurrence).</p> : draft.others.map((party) => (
          <div key={party.itemId} className="space-y-2 rounded-lg border border-border bg-background p-2.5">
            <div className="grid gap-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1.5fr)_minmax(8rem,1fr)_auto] sm:items-end">
              <Pick label="Type" required value={party.partyType} options={COLLISION_OTHER_PARTY_TYPES} onChange={(partyType) => patchOther(party.itemId, { partyType })} />
              <Txt label={party.partyType === "OTHER" ? "Description *" : "Description"} value={party.description} onChange={(description) => patchOther(party.itemId, { description })} />
              <Txt label="Plate / identifier" value={party.identifier} onChange={(identifier) => patchOther(party.itemId, { identifier })} />
              {removeButton(() => update((d) => ({ ...d, others: d.others.filter((item) => item.itemId !== party.itemId), persons: d.persons.map((person) => (person.linkedPartyId === party.itemId ? { ...person, linkedPartyId: "" } : person)) })))}
            </div>
            <UnitFields detail={party} onChange={(change) => patchOther(party.itemId, change)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function PersonsEditor({ draft, update, vehicles, injuryStatus }: { draft: CollisionDraft; update: Update; vehicles: { powerUnits: NearMissVehicleChoice[]; trailers: NearMissVehicleChoice[] }; injuryStatus: string }) {
  const unit = (id: string) => [...vehicles.powerUnits, ...vehicles.trailers].find((vehicle) => vehicle.id === id);
  const partyChoices: CollisionOption[] = [
    ...[draft.powerUnitId, ...draft.trailerIds].filter(Boolean).map((id) => ({ value: carrierPartyItemId(id), label: `Unit ${unit(id)?.unitNumber || id}` })),
    ...draft.others.map((party, index) => ({ value: party.itemId, label: `${collisionOptionLabel(COLLISION_OTHER_PARTY_TYPES, party.partyType) || "Other party"} #${index + 1}` })),
  ];
  const patch = (itemId: string, change: Partial<CollisionDraft["persons"][number]>) => update((d) => ({ ...d, persons: d.persons.map((person) => (person.itemId === itemId ? { ...person, ...change } : person)) }));
  return (
    <div className={sectionClass} data-testid="collision-persons">
      <Header title="Injured persons" hint="Optional. Reporting an injury does not require medical detail; add people and detail as it becomes known." action={injuryStatus === "NO_INJURY_REPORTED" ? undefined : addButton("Add injured person", () => update((d) => ({ ...d, persons: [...d.persons, { itemId: uid("CIP"), role: "", name: "", linkedPartyId: "", injurySeverity: "", transported: "", treatmentStatus: "", facility: "", fatalityDate: "", notes: "", accessClassification: "RESTRICTED_MEDICAL", evidenceIds: [] }] })))} />
      {injuryStatus === "NO_INJURY_REPORTED" ? <p className="rounded-lg border border-dashed border-border p-2.5 text-[11px] text-muted-foreground">Injury Status is "No injury reported", so no injured persons can be recorded. Change it in Immediate Outcomes if that is wrong.</p>
        : draft.persons.length === 0 ? <p className="rounded-lg border border-dashed border-border p-2.5 text-[11px] text-muted-foreground">No injured persons recorded yet. The Injury Status above is enough to submit.</p>
        : draft.persons.map((person, index) => (
          <div key={person.itemId} className="space-y-2 rounded-lg border border-border bg-background p-2.5">
            <div className="flex items-center justify-between"><span className="text-[11px] font-bold">Person {index + 1}</span>{removeButton(() => update((d) => ({ ...d, persons: d.persons.filter((item) => item.itemId !== person.itemId) })))}</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Pick label="Role" required value={person.role} options={COLLISION_PERSON_ROLES} onChange={(role) => patch(person.itemId, { role })} />
              <Txt label="Name / identifier (if known)" value={person.name} onChange={(name) => patch(person.itemId, { name })} />
              <Pick label="In / with" value={person.linkedPartyId} options={partyChoices} onChange={(linkedPartyId) => patch(person.itemId, { linkedPartyId })} />
              <Pick label="Injury severity" value={person.injurySeverity} options={COLLISION_INJURY_SEVERITIES} onChange={(injurySeverity) => patch(person.itemId, { injurySeverity, ...(injurySeverity === "FATAL" ? {} : { fatalityDate: "" }) })} />
              <Pick label="Transported from scene" value={person.transported} options={COLLISION_YES_NO_UNKNOWN} onChange={(transported) => patch(person.itemId, { transported })} />
              <Pick label="Treatment" value={person.treatmentStatus} options={COLLISION_TREATMENT_STATUSES} onChange={(treatmentStatus) => patch(person.itemId, { treatmentStatus })} />
              <Txt label="Facility" value={person.facility} onChange={(facility) => patch(person.itemId, { facility })} />
              {person.injurySeverity === "FATAL" ? <Txt label="Fatality date" type="date" value={person.fatalityDate} onChange={(fatalityDate) => patch(person.itemId, { fatalityDate })} /> : null}
            </div>
            <label className="block text-[11px] font-semibold text-foreground">Notes<textarea rows={2} value={person.notes} onChange={(e) => patch(person.itemId, { notes: e.target.value })} className={inputClass} /></label>
            <Pick label="Access classification of the medical information" value={person.accessClassification} options={COLLISION_ACCESS_CLASSES} onChange={(accessClassification) => patch(person.itemId, { accessClassification })} className="sm:max-w-xs" />
          </div>
        ))}
    </div>
  );
}

/** Immediate-outcome summary derived from the per-vehicle records (read-only here; edited under Parties & Equipment). */
function VehicleOutcomeSummary({ draft, vehicles }: { draft: CollisionDraft; vehicles: { powerUnits: NearMissVehicleChoice[]; trailers: NearMissVehicleChoice[] } }) {
  const unit = (id: string) => [...vehicles.powerUnits, ...vehicles.trailers].find((vehicle) => vehicle.id === id);
  const rows = [
    ...[draft.powerUnitId, ...draft.trailerIds].filter(Boolean).map((id) => ({ name: `Unit ${unit(id)?.unitNumber || id}`, detail: draft.carriers[id] || emptyUnitDetail() })),
    ...draft.others.map((party, index) => ({ name: `${collisionOptionLabel(COLLISION_OTHER_PARTY_TYPES, party.partyType) || "Other party"} #${index + 1}`, detail: party as CollisionDraftUnitDetail })),
  ];
  return (
    <div className="rounded-lg border border-border bg-background p-2.5" data-testid="collision-vehicle-outcomes">
      <div className="mb-1 text-[11px] font-bold">Vehicle damage, drivability and tow (from Parties & Equipment)</div>
      {rows.length === 0 ? <p className="text-[11px] text-muted-foreground">No vehicles recorded yet.</p> : <ul className="space-y-0.5 text-[11px]">{rows.map((row) => <li key={row.name} className="flex flex-wrap gap-x-3"><span className="font-semibold">{row.name}</span><span className="text-muted-foreground">Damage: {collisionOptionLabel(COLLISION_DAMAGE_STATUSES, row.detail.damageStatus) || "not recorded"} · Drivability: {collisionOptionLabel(COLLISION_DRIVABILITY, row.detail.drivability) || "not recorded"} · Tow: {collisionOptionLabel(COLLISION_TOW_STATUSES, row.detail.towStatus) || "not recorded"}</span></li>)}</ul>}
    </div>
  );
}

const fieldGrid = (keys: string[], renderField: (key: string) => React.ReactNode, className = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3") => <div className={className}>{keys.map((key) => <React.Fragment key={key}>{renderField(key)}</React.Fragment>)}</div>;

export function CollisionStepPanel({ stepKey, draft, update, facts, renderField, companyId }: {
  stepKey: string; draft: CollisionDraft; update: Update; facts: Record<string, unknown>; renderField: (key: string) => React.ReactNode; companyId: string;
}) {
  const vehicles = useNearMissVehicles(companyId);
  const injuryStatus = typeof facts.injuryStatus === "string" ? facts.injuryStatus : "";
  const title = (text: string, hint: string) => <div><h4 className="text-sm font-bold text-foreground">{text}</h4><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div>;
  if (stepKey === "COLLISION_FACTS") return (
    <section className="space-y-4">{title("Collision Facts", "Three independent facts: what kind of occurrence, how the units interacted, and the first event that caused harm.")}
      {fieldGrid(["collisionClassType", "collisionManner", "firstHarmfulEvent"], renderField)}
      {fieldGrid(["driverActivity", "driverAction"], renderField, "grid gap-3 sm:grid-cols-2")}
      <SequenceEditor draft={draft} update={update} />
    </section>
  );
  if (stepKey === "COLLISION_PARTIES") return <section className="space-y-4">{title("Parties & Equipment", "Carrier equipment and every other vehicle, person or object involved.")}<PartiesEditor draft={draft} update={update} vehicles={vehicles} /></section>;
  if (stepKey === "COLLISION_ENVIRONMENT") return (
    <section className="space-y-4">{title("Environment & Operations", "Conditions at the time. Trip, dispatch, HOS and site context are not captured because TES has no canonical records to link them to.")}
      {fieldGrid(["weather", "roadCondition", "lightCondition", "visibility", "trafficCondition", "workZone", "speedAtOccurrence"], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}
    </section>
  );
  if (stepKey === "COLLISION_OUTCOMES") return (
    <section className="space-y-4">{title("Immediate Outcomes", "What is known now. Everything except Injury Status is optional.")}
      {fieldGrid(["injuryStatus", "policeResponse", "policeReportReference", "enforcementStatus", "cargoImpact", "hazmatConsequence", "serviceInterruption", "downtimeHours"], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}
      <VehicleOutcomeSummary draft={draft} vehicles={vehicles} />
      <div className="rounded-lg border border-border bg-muted/10 p-3">{fieldGrid(["reportabilityResult", "driverStatementRequired"], renderField, "grid gap-3 sm:grid-cols-2")}<p className="mt-2 text-[10px] text-muted-foreground">Reportability is a manual determination; TES does not derive it from the facts. A Driver Statement is only required when you say so.</p></div>
    </section>
  );
  if (stepKey === "COLLISION_INJURIES") return <section className="space-y-4">{title("Injured Persons", "Person-level records. The Injury Status in Immediate Outcomes is what is required.")}<PersonsEditor draft={draft} update={update} vehicles={vehicles} injuryStatus={injuryStatus} /></section>;
  return null;
}

/** Evidence & Statements: the multiline Driver Statement, and references from child records to the single canonical evidence set. */
export function CollisionEvidencePanel({ draft, update, evidence, companyId }: { draft: CollisionDraft; update: Update; evidence: CollisionEvidenceChoice[]; companyId: string }) {
  const vehicles = useNearMissVehicles(companyId);
  const statement = draft.statement;
  const setStatement = (change: Partial<CollisionDraft["statement"]>) => update((d) => ({ ...d, statement: { ...d.statement, ...change } }));
  const unit = (id: string) => [...vehicles.powerUnits, ...vehicles.trailers].find((vehicle) => vehicle.id === id);
  const links: Array<{ key: string; label: string; ids: string[]; set: (ids: string[]) => void }> = [
    ...draft.sequence.map((step) => ({ key: step.itemId, label: `Sequence step ${step.ordinal || "?"}`, ids: step.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, sequence: d.sequence.map((item) => (item.itemId === step.itemId ? { ...item, evidenceIds: ids } : item)) })) })),
    ...[draft.powerUnitId, ...draft.trailerIds].filter(Boolean).map((id) => ({ key: id, label: `Unit ${unit(id)?.unitNumber || id}`, ids: (draft.carriers[id] || emptyUnitDetail()).evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, carriers: { ...d.carriers, [id]: { ...(d.carriers[id] || emptyUnitDetail()), evidenceIds: ids } } })) })),
    ...draft.others.map((party, index) => ({ key: party.itemId, label: `${collisionOptionLabel(COLLISION_OTHER_PARTY_TYPES, party.partyType) || "Other party"} #${index + 1}`, ids: party.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, others: d.others.map((item) => (item.itemId === party.itemId ? { ...item, evidenceIds: ids } : item)) })) })),
    ...draft.persons.map((person, index) => ({ key: person.itemId, label: `Injured person ${index + 1}`, ids: person.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, persons: d.persons.map((item) => (item.itemId === person.itemId ? { ...item, evidenceIds: ids } : item)) })) })),
    ...(statement.status ? [{ key: statement.itemId, label: "Driver Statement", ids: statement.evidenceIds, set: (ids: string[]) => setStatement({ evidenceIds: ids }) }] : []),
  ];
  return (
    <div className="space-y-4" data-testid="collision-evidence-panel">
      <div className={sectionClass}>
        <Header title="Driver Statement" hint="The driver's account. It is evidence, not an investigation conclusion. Optional unless the Collision marks it required." />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Pick label="Status" value={statement.status} options={COLLISION_STATEMENT_STATUSES} onChange={(status) => setStatement({ status, ...(status === "" ? { content: "", method: "", date: "", time: "" } : {}) })} />
          <Pick label="Method" value={statement.method} options={COLLISION_STATEMENT_METHODS} onChange={(method) => setStatement({ method })} />
          <Txt label="Provided date" type="date" value={statement.date} onChange={(date) => setStatement({ date })} />
          <Txt label="Provided time" type="time" value={statement.time} onChange={(time) => setStatement({ time })} />
        </div>
        {statement.status === "OBTAINED" ? <label className="block text-[11px] font-semibold text-foreground">Statement <span className="text-destructive">*</span><textarea rows={7} value={statement.content} onChange={(e) => setStatement({ content: e.target.value })} className={`${inputClass} min-h-32 resize-y leading-5`} placeholder="Record the driver's statement in their own words." /></label> : null}
      </div>
      <div className={sectionClass}>
        <Header title="Evidence references" hint="Evidence is stored once for the Collision. Tick the evidence that supports each record below; nothing is copied." />
        {evidence.length === 0 ? <p className="rounded-lg border border-dashed border-border p-2.5 text-[11px] text-muted-foreground">Add evidence above first, then link it to records here.</p>
          : links.length === 0 ? <p className="rounded-lg border border-dashed border-border p-2.5 text-[11px] text-muted-foreground">No sequence steps, vehicles, persons or statement to link yet.</p>
          : <div className="space-y-2">{links.map((link) => (
            <div key={link.key} className="rounded-lg border border-border bg-background p-2">
              <div className="text-[11px] font-bold">{link.label}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">{evidence.map((item) => <label key={item.id} className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] ${link.ids.includes(item.id) ? "border-primary bg-primary/5" : "border-border"}`}><input type="checkbox" className="size-3 accent-primary" checked={link.ids.includes(item.id)} onChange={() => link.set(toggle(link.ids, item.id))} />{item.label}</label>)}</div>
            </div>
          ))}</div>}
      </div>
    </div>
  );
}

export function CollisionReviewBlock({ draft, vehicles }: { draft: CollisionDraft; vehicles: { powerUnits: NearMissVehicleChoice[]; trailers: NearMissVehicleChoice[] } }) {
  const unit = (id: string) => `Unit ${[...vehicles.powerUnits, ...vehicles.trailers].find((vehicle) => vehicle.id === id)?.unitNumber || id}`;
  const row = (name: string, value: string) => <div className="flex justify-between gap-4 text-xs"><span className="text-muted-foreground">{name}</span><span className="text-right font-semibold">{value || "None"}</span></div>;
  return (
    <div className="space-y-2 rounded-xl border border-border p-4" data-testid="collision-review">
      <div className="mb-1 text-xs font-bold">Collision Records</div>
      {row("Power Unit", draft.powerUnitId ? unit(draft.powerUnitId) : "")}
      {row("Trailer(s)", draft.trailerIds.map(unit).join(", "))}
      {row("Other parties / objects", draft.others.map((party) => collisionOptionLabel(COLLISION_OTHER_PARTY_TYPES, party.partyType) || "Unspecified").join(", "))}
      {row("Event sequence steps", String(draft.sequence.length))}
      {row("Injured persons", String(draft.persons.length))}
      {row("Driver Statement", draft.statement.status ? collisionOptionLabel(COLLISION_STATEMENT_STATUSES, draft.statement.status) : "")}
    </div>
  );
}
