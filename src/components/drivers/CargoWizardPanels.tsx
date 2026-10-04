"use client";

import React from "react";
import {
  CARGO_ANOMALY_TYPES, CARGO_CONTROL_STATES, CARGO_CONTROL_TYPES, CARGO_CURRENCIES, CARGO_CUSTODY_ROLES, CARGO_CUSTODY_STAGES, CARGO_DAMAGE_ORIGINS, CARGO_DAMAGE_SCOPES, CARGO_DAMAGE_TYPES, CARGO_DISCOVERY_METHODS,
  CARGO_DISPOSITIONS, CARGO_GPS_STATES, CARGO_ITEM_STATUSES, CARGO_LOCATION_TYPES, CARGO_MEASUREMENT_SOURCES, CARGO_OCCURRENCE_PRECISIONS, CARGO_POLICE_RESPONSES, CARGO_QUANTITY_UNITS, CARGO_RECOVERY_STATUSES,
  CARGO_REEFER_FUEL, CARGO_REEFER_STATUSES, CARGO_REPORTED_CAUSES, CARGO_SEAL_STATES, CARGO_SECONDARY_BY_FAMILY, CARGO_TEMPERATURE_UNITS, CARGO_THEFT_METHODS, CARGO_THEFT_STATUSES, CARGO_THEFT_TARGETS, CARGO_TIME_CERTAINTIES,
  CARGO_TRACKING_STATUSES, CARGO_VERIFICATION_METHODS, CARGO_YES_NO_UNKNOWN, cargoOptionLabel, type CargoOption,
} from "@/lib/performance-cargo-taxonomy";
import {
  CARGO_RESPONSE_FACT_KEYS, deriveCargoControlGap, emptyCargoControl, emptyCargoCustody, emptyCargoDamage, emptyCargoItem, emptyCargoTemperature, emptyCargoTheft,
  type CargoDraft, type CargoDraftCustody, type CargoDraftItem,
} from "@/lib/performance-cargo";
import { loadCompanies } from "@/lib/vehicle-data";
import { useNearMissVehicles } from "./NearMissWizardPanels";

const inputClass = "mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";
const sectionClass = "space-y-3 rounded-xl border border-border bg-muted/10 p-4";
const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

type Update = (updater: (draft: CargoDraft) => CargoDraft) => void;
export interface CargoEvidenceChoice { id: string; label: string }

function Pick({ label, value, options, onChange, required, className = "" }: { label: string; value: string; options: readonly CargoOption[]; onChange: (value: string) => void; required?: boolean; className?: string }) {
  return <label className={`block min-w-0 text-[11px] font-semibold text-foreground ${className}`}>{label}{required ? <span className="text-destructive"> *</span> : null}<select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}><option value="">Select...</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
function Txt({ label, value, onChange, type = "text", required, placeholder, className = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string; className?: string }) {
  return <label className={`block min-w-0 text-[11px] font-semibold text-foreground ${className}`}>{label}{required ? <span className="text-destructive"> *</span> : null}<input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} /></label>;
}
function Money({ label, value, currency, onValue, onCurrency }: { label: string; value: string; currency: string; onValue: (value: string) => void; onCurrency: (value: string) => void }) {
  return <div className="min-w-0 text-[11px] font-semibold text-foreground"><span>{label}</span><div className="mt-1 flex gap-1.5"><input aria-label={label} type="number" min="0" step="0.01" value={value} onChange={(e) => onValue(e.target.value)} className={`${inputClass} !mt-0`} /><select aria-label={`${label} currency`} value={currency} onChange={(e) => onCurrency(e.target.value)} className={`${inputClass} !mt-0 w-20`}>{CARGO_CURRENCIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div>;
}
const Header = ({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) => <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h5 className="text-xs font-bold text-foreground">{title}</h5>{hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}</div>{action}</div>;
const addButton = (label: string, onClick: () => void) => <button type="button" onClick={onClick} className="rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-bold hover:bg-muted">{label}</button>;
const removeButton = (onClick: () => void) => <button type="button" onClick={onClick} className="justify-self-end text-[10px] font-bold text-destructive hover:underline">Remove</button>;
const Empty = ({ text }: { text: string }) => <p className="rounded-lg border border-dashed border-border p-2.5 text-[11px] text-muted-foreground">{text}</p>;
const card = "space-y-2 rounded-lg border border-border bg-background p-2.5";
const grid = (cols = "sm:grid-cols-2 lg:grid-cols-4") => `grid gap-2 ${cols}`;

/** Occurrence extras: precision, estimated window, discovery and reported time. Derived delays are never stored. */
export function CargoOccurrenceExtras({ draft, update, facts, setFact }: { draft: CargoDraft; update: Update; facts: Record<string, unknown>; setFact: (key: string, value: string | null) => void }) {
  const val = (key: string) => (typeof facts[key] === "string" ? (facts[key] as string) : "");
  return (
    <div className={sectionClass} data-testid="cargo-occurrence-extras">
      <Header title="Occurrence precision, discovery and report" hint="Occurrence, discovery and report are separate. Unknown or approximate values are kept as such." />
      <div className={grid()}>
        <Pick label="Occurrence precision" required value={draft.precision} options={CARGO_OCCURRENCE_PRECISIONS} onChange={(precision) => update((d) => ({ ...d, precision }))} />
        <Txt label="Estimated window - start" type="datetime-local" value={val("occurrenceWindowStart")} onChange={(v) => setFact("occurrenceWindowStart", v || null)} />
        <Txt label="Estimated window - end" type="datetime-local" value={val("occurrenceWindowEnd")} onChange={(v) => setFact("occurrenceWindowEnd", v || null)} />
        <Txt label="Basis for the window" value={val("occurrenceWindowBasis")} onChange={(v) => setFact("occurrenceWindowBasis", v || null)} />
        <Txt label="Discovery date" type="date" value={val("discoveryDate")} onChange={(v) => setFact("discoveryDate", v || null)} />
        <Txt label="Discovery time" type="time" value={val("discoveryTime")} onChange={(v) => setFact("discoveryTime", v || null)} />
        <Txt label="Reported time" type="time" value={val("reportedTime")} onChange={(v) => setFact("reportedTime", v || null)} />
      </div>
    </div>
  );
}

function ItemEditor({ draft, update }: { draft: CargoDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<CargoDraftItem>) => update((d) => ({ ...d, items: d.items.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  return (
    <div className={sectionClass} data-testid="cargo-items">
      <Header title="Cargo items (optional detail)" hint="Add commodity groups when they are known. Leave a quantity or value blank when it is not known - blank is never treated as zero." action={addButton("Add cargo item", () => update((d) => ({ ...d, items: [...d.items, emptyCargoItem()] })))} />
      {draft.items.length === 0 ? <Empty text="Detailed cargo items not recorded. You can continue now and add them when they are known." /> : draft.items.map((item, index) => (
        <div key={item.itemId} className={card}>
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold">Item {index + 1}</span>{removeButton(() => update((d) => ({ ...d, items: d.items.filter((entry) => entry.itemId !== item.itemId), damage: d.damage ? { ...d.damage, affectedItemIds: d.damage.affectedItemIds.filter((id) => id !== item.itemId) } : d.damage, custody: d.custody.map((entry) => ({ ...entry, itemIds: entry.itemIds.filter((id) => id !== item.itemId) })) })))}</div>
          <div className={grid()}>
            <Txt label="Commodity / description" required value={item.commodity} onChange={(commodity) => patch(item.itemId, { commodity })} className="sm:col-span-2" />
            <Txt label="Item / reference code" value={item.itemCode} onChange={(itemCode) => patch(item.itemId, { itemCode })} />
            <Pick label="Condition / status" value={item.condition} options={CARGO_ITEM_STATUSES} onChange={(condition) => patch(item.itemId, { condition })} />
            <Txt label="Quantity" type="number" value={item.quantity} onChange={(quantity) => patch(item.itemId, { quantity })} />
            <Pick label="Unit" value={item.quantityUnit} options={CARGO_QUANTITY_UNITS} onChange={(quantityUnit) => patch(item.itemId, { quantityUnit })} />
            <Pick label="Hazmat" value={item.hazmat} options={CARGO_YES_NO_UNKNOWN} onChange={(hazmat) => patch(item.itemId, { hazmat })} />
            <Pick label="Temperature-sensitive" value={item.temperatureSensitive} options={CARGO_YES_NO_UNKNOWN} onChange={(temperatureSensitive) => patch(item.itemId, { temperatureSensitive })} />
            <Money label="Declared value" value={item.declaredValue} currency={item.declaredCurrency} onValue={(declaredValue) => patch(item.itemId, { declaredValue })} onCurrency={(declaredCurrency) => patch(item.itemId, { declaredCurrency })} />
            <Money label="Insured value" value={item.insuredValue} currency={item.insuredCurrency} onValue={(insuredValue) => patch(item.itemId, { insuredValue })} onCurrency={(insuredCurrency) => patch(item.itemId, { insuredCurrency })} />
          </div>
          <details><summary className="cursor-pointer text-[10px] font-bold text-muted-foreground">Affected / damaged / stolen / recovered quantities and affected value</summary>
            <div className={`mt-2 ${grid()}`}>
              <Txt label="Affected quantity" type="number" value={item.affectedQuantity} onChange={(affectedQuantity) => patch(item.itemId, { affectedQuantity })} />
              <Txt label="Damaged quantity" type="number" value={item.damagedQuantity} onChange={(damagedQuantity) => patch(item.itemId, { damagedQuantity })} />
              <Txt label="Stolen quantity" type="number" value={item.stolenQuantity} onChange={(stolenQuantity) => patch(item.itemId, { stolenQuantity })} />
              <Txt label="Recovered quantity" type="number" value={item.recoveredQuantity} onChange={(recoveredQuantity) => patch(item.itemId, { recoveredQuantity })} />
              <Money label="Affected value" value={item.affectedValue} currency={item.affectedCurrency} onValue={(affectedValue) => patch(item.itemId, { affectedValue })} onCurrency={(affectedCurrency) => patch(item.itemId, { affectedCurrency })} />
              <Txt label="Notes" value={item.notes} onChange={(notes) => patch(item.itemId, { notes })} className="sm:col-span-2" />
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

function ItemChecks({ draft, selected, onChange }: { draft: CargoDraft; selected: string[]; onChange: (ids: string[]) => void }) {
  return <fieldset className="min-w-0 text-[11px] font-semibold text-foreground"><legend>Affected cargo items</legend><div className="mt-1 flex flex-wrap gap-1.5">{draft.items.length === 0 ? <span className="text-[10px] font-normal text-muted-foreground">Add cargo items first.</span> : draft.items.map((item) => <label key={item.itemId} className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] ${selected.includes(item.itemId) ? "border-primary bg-primary/5" : "border-border bg-background"}`}><input type="checkbox" className="size-3.5 accent-primary" checked={selected.includes(item.itemId)} onChange={() => onChange(toggle(selected, item.itemId))} />{item.commodity || "Unnamed item"}</label>)}</div></fieldset>;
}

function DamageModule({ draft, update }: { draft: CargoDraft; update: Update }) {
  const damage = draft.damage;
  const patch = (change: Partial<NonNullable<CargoDraft["damage"]>>) => update((d) => ({ ...d, damage: d.damage ? { ...d.damage, ...change } : d.damage }));
  return (
    <div className={sectionClass} data-testid="cargo-damage-module">
      <Header title="Damage outcome" hint="Optional. Reported / suspected cause is what was reported - it is not the root cause." action={damage ? removeButton(() => update((d) => ({ ...d, damage: null })), ) : addButton("Add damage outcome", () => update((d) => ({ ...d, damage: emptyCargoDamage() })))} />
      {!damage ? <Empty text="No damage outcome recorded." /> : (
        <div className="space-y-2">
          <div className={grid()}>
            <Pick label="Damage type" value={damage.damageType} options={CARGO_DAMAGE_TYPES} onChange={(damageType) => patch({ damageType })} />
            <Pick label="Scope" value={damage.scope} options={CARGO_DAMAGE_SCOPES} onChange={(scope) => patch({ scope })} />
            <Pick label="Discovery point" value={damage.discoveryPoint} options={CARGO_CUSTODY_STAGES} onChange={(discoveryPoint) => patch({ discoveryPoint })} />
            <Pick label="Damage origin" value={damage.origin} options={CARGO_DAMAGE_ORIGINS} onChange={(origin) => patch({ origin })} />
            <Pick label="Disposition" value={damage.disposition} options={CARGO_DISPOSITIONS} onChange={(disposition) => patch({ disposition })} />
            <Money label="Damaged value" value={damage.damagedValue} currency={damage.damagedCurrency} onValue={(damagedValue) => patch({ damagedValue })} onCurrency={(damagedCurrency) => patch({ damagedCurrency })} />
            <Pick label="Reported / Suspected Cause" value={damage.reportedCause} options={CARGO_REPORTED_CAUSES} onChange={(reportedCause) => patch({ reportedCause })} />
            {damage.reportedCause === "OTHER" ? <Txt label="Other cause detail" required value={damage.reportedCauseOther} onChange={(reportedCauseOther) => patch({ reportedCauseOther })} /> : null}
          </div>
          <ItemChecks draft={draft} selected={damage.affectedItemIds} onChange={(affectedItemIds) => patch({ affectedItemIds })} />
          <label className="block text-[11px] font-semibold text-foreground">Narrative<textarea rows={2} value={damage.narrative} onChange={(e) => patch({ narrative: e.target.value })} className={inputClass} /></label>
        </div>
      )}
    </div>
  );
}

function TemperatureModule({ draft, update }: { draft: CargoDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<CargoDraft["temperatures"][number]>) => update((d) => ({ ...d, temperatures: d.temperatures.map((obs) => (obs.itemId === itemId ? { ...obs, ...change } : obs)) }));
  return (
    <div className={sectionClass} data-testid="cargo-temperature-module">
      <Header title="Temperature observations" hint="Optional. Each reading keeps its own source; contradictory readings stay separate. An excursion is not assumed to be a reefer failure." action={addButton("Add observation", () => update((d) => ({ ...d, temperatures: [...d.temperatures, emptyCargoTemperature()] })))} />
      {draft.temperatures.length === 0 ? <Empty text="No temperature observations." /> : draft.temperatures.map((obs, index) => (
        <div key={obs.itemId} className={card}>
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold">Observation {index + 1}</span>{removeButton(() => update((d) => ({ ...d, temperatures: d.temperatures.filter((entry) => entry.itemId !== obs.itemId) })))}</div>
          <div className={grid("sm:grid-cols-3 lg:grid-cols-6")}>
            <Txt label="Required / setpoint" type="number" value={obs.setpoint} onChange={(setpoint) => patch(obs.itemId, { setpoint })} />
            <Txt label="Actual minimum" type="number" value={obs.minimum} onChange={(minimum) => patch(obs.itemId, { minimum })} />
            <Txt label="Actual maximum" type="number" value={obs.maximum} onChange={(maximum) => patch(obs.itemId, { maximum })} />
            <Pick label="Unit" value={obs.unit} options={CARGO_TEMPERATURE_UNITS} onChange={(unit) => patch(obs.itemId, { unit })} />
            <Txt label="Excursion (minutes)" type="number" value={obs.excursionMinutes} onChange={(excursionMinutes) => patch(obs.itemId, { excursionMinutes })} />
            <Pick label="Measurement source" required value={obs.source} options={CARGO_MEASUREMENT_SOURCES} onChange={(source) => patch(obs.itemId, { source })} />
            <Pick label="Reefer status" value={obs.reeferStatus} options={CARGO_REEFER_STATUSES} onChange={(reeferStatus) => patch(obs.itemId, { reeferStatus })} />
            <Pick label="Reefer fuel" value={obs.reeferFuel} options={CARGO_REEFER_FUEL} onChange={(reeferFuel) => patch(obs.itemId, { reeferFuel })} />
            <Pick label="Door open" value={obs.doorOpen} options={CARGO_YES_NO_UNKNOWN} onChange={(doorOpen) => patch(obs.itemId, { doorOpen })} />
            <Txt label="Observed at" type="datetime-local" value={obs.observedAt} onChange={(observedAt) => patch(obs.itemId, { observedAt })} />
            <Txt label="Note" value={obs.note} onChange={(note) => patch(obs.itemId, { note })} className="sm:col-span-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TheftModule({ draft, update }: { draft: CargoDraft; update: Update }) {
  const theft = draft.theft;
  const patch = (change: Partial<NonNullable<CargoDraft["theft"]>>) => update((d) => ({ ...d, theft: d.theft ? { ...d.theft, ...change } : d.theft }));
  return (
    <div className={sectionClass} data-testid="cargo-theft-module">
      <Header title="Theft outcome" hint="Optional. Theft of tractors, trailers or equipment is a Security Incident, not cargo loss." action={theft ? removeButton(() => update((d) => ({ ...d, theft: null }))) : addButton("Add theft outcome", () => update((d) => ({ ...d, theft: emptyCargoTheft() })))} />
      {!theft ? <Empty text="No theft outcome recorded." /> : (
        <div className="space-y-2">
          <div className={grid()}>
            <Pick label="Theft status" value={theft.status} options={CARGO_THEFT_STATUSES} onChange={(status) => patch({ status })} />
            <Pick label="Method" value={theft.method} options={CARGO_THEFT_METHODS} onChange={(method) => patch({ method })} />
            <Pick label="Target" value={theft.target} options={CARGO_THEFT_TARGETS} onChange={(target) => patch({ target })} />
            <Pick label="Location type" value={theft.locationType} options={CARGO_LOCATION_TYPES} onChange={(locationType) => patch({ locationType })} />
            <Txt label="Location risk / context" value={theft.locationContext} onChange={(locationContext) => patch({ locationContext })} className="sm:col-span-2" />
            <Pick label="Time certainty" value={theft.timeCertainty} options={CARGO_TIME_CERTAINTIES} onChange={(timeCertainty) => patch({ timeCertainty, ...(timeCertainty === "EXACT" ? { windowStart: "", windowEnd: "", windowBasis: "" } : timeCertainty === "ESTIMATED_WINDOW" ? { exactTime: "" } : { exactTime: "", windowStart: "", windowEnd: "", windowBasis: "" }) })} />
            {theft.timeCertainty === "EXACT" ? <Txt label="Exact time" required type="datetime-local" value={theft.exactTime} onChange={(exactTime) => patch({ exactTime })} /> : null}
            {theft.timeCertainty === "ESTIMATED_WINDOW" ? <><Txt label="Window start" required type="datetime-local" value={theft.windowStart} onChange={(windowStart) => patch({ windowStart })} /><Txt label="Window end" required type="datetime-local" value={theft.windowEnd} onChange={(windowEnd) => patch({ windowEnd })} /><Txt label="Basis for the window" value={theft.windowBasis} onChange={(windowBasis) => patch({ windowBasis })} /></> : null}
            <Pick label="Discovery method" value={theft.discoveryMethod} options={CARGO_DISCOVERY_METHODS} onChange={(discoveryMethod) => patch({ discoveryMethod })} />
            <Pick label="Tracking status" value={theft.trackingStatus} options={CARGO_TRACKING_STATUSES} onChange={(trackingStatus) => patch({ trackingStatus })} />
            <Pick label="Seal state" value={theft.sealState} options={CARGO_SEAL_STATES} onChange={(sealState) => patch({ sealState })} />
            <Pick label="Police response" value={theft.policeResponse} options={CARGO_POLICE_RESPONSES} onChange={(policeResponse) => patch({ policeResponse })} />
            <Txt label="Police reference" value={theft.policeReference} onChange={(policeReference) => patch({ policeReference })} />
            <Pick label="Recovery status" value={theft.recoveryStatus} options={CARGO_RECOVERY_STATUSES} onChange={(recoveryStatus) => patch({ recoveryStatus })} />
            <Money label="Stolen value" value={theft.stolenValue} currency={theft.stolenCurrency} onValue={(stolenValue) => patch({ stolenValue })} onCurrency={(stolenCurrency) => patch({ stolenCurrency })} />
            <Money label="Recovered value" value={theft.recoveredValue} currency={theft.recoveredCurrency} onValue={(recoveredValue) => patch({ recoveredValue })} onCurrency={(recoveredCurrency) => patch({ recoveredCurrency })} />
          </div>
          <label className="block text-[11px] font-semibold text-foreground">Narrative<textarea rows={2} value={theft.narrative} onChange={(e) => patch({ narrative: e.target.value })} className={inputClass} /></label>
        </div>
      )}
    </div>
  );
}

function CustodyEditor({ draft, update, vehicles }: { draft: CargoDraft; update: Update; vehicles: { powerUnits: Array<{ id: string; unitNumber: string }>; trailers: Array<{ id: string; unitNumber: string }> } }) {
  const patch = (itemId: string, change: Partial<CargoDraftCustody>) => update((d) => ({ ...d, custody: d.custody.map((entry) => (entry.itemId === itemId ? { ...entry, ...change } : entry)) }));
  const linked = [draft.powerUnitId, ...draft.trailerIds].filter(Boolean).map((id) => ({ value: id, label: `Unit ${[...vehicles.powerUnits, ...vehicles.trailers].find((vehicle) => vehicle.id === id)?.unitNumber || id}` }));
  return (
    <div className={sectionClass} data-testid="cargo-custody">
      <Header title="Custody timeline" hint="Ordered by the sequence number. Mark the Last Known Good and the First Security Anomaly. Custodians are free text." action={addButton("Add custody record", () => update((d) => ({ ...d, custody: [...d.custody, emptyCargoCustody(Math.max(0, ...d.custody.map((entry) => Number(entry.ordinal) || 0)) + 1)] })))} />
      {draft.custody.length === 0 ? <Empty text="No custody records." /> : draft.custody.map((entry) => (
        <div key={entry.itemId} className={card}>
          <div className={grid("sm:grid-cols-2 lg:grid-cols-[4.5rem_1fr_1fr_1fr_auto] lg:items-end")}>
            <Txt label="No." type="number" value={entry.ordinal} onChange={(ordinal) => patch(entry.itemId, { ordinal })} />
            <Pick label="Record type" value={entry.role} options={CARGO_CUSTODY_ROLES} onChange={(role) => patch(entry.itemId, { role, ...(role === "FIRST_SECURITY_ANOMALY" ? {} : { anomalyType: "" }) })} />
            <Txt label="Event" value={entry.event} onChange={(event) => patch(entry.itemId, { event })} />
            <Txt label="Date / time" type="datetime-local" value={entry.timestamp} onChange={(timestamp) => patch(entry.itemId, { timestamp })} />
            {removeButton(() => update((d) => ({ ...d, custody: d.custody.filter((item) => item.itemId !== entry.itemId) })))}
          </div>
          {entry.role === "FIRST_SECURITY_ANOMALY" ? <Pick label="Anomaly type (an observation, not a confirmed theft method)" required value={entry.anomalyType} options={CARGO_ANOMALY_TYPES} onChange={(anomalyType) => patch(entry.itemId, { anomalyType })} className="sm:max-w-md" /> : null}
          <div className={grid()}>
            <Txt label="Location" value={entry.location} onChange={(location) => patch(entry.itemId, { location })} />
            <Txt label="Custodian (free text)" value={entry.custodian} onChange={(custodian) => patch(entry.itemId, { custodian })} />
            <Pick label="Vehicle" value={entry.linkedVehicleId} options={linked} onChange={(linkedVehicleId) => patch(entry.itemId, { linkedVehicleId })} />
            <Pick label="Seal state" value={entry.sealState} options={CARGO_SEAL_STATES} onChange={(sealState) => patch(entry.itemId, { sealState })} />
            <Pick label="GPS / tracking" value={entry.gpsState} options={CARGO_GPS_STATES} onChange={(gpsState) => patch(entry.itemId, { gpsState })} />
            <Pick label="Verification" value={entry.verificationMethod} options={CARGO_VERIFICATION_METHODS} onChange={(verificationMethod) => patch(entry.itemId, { verificationMethod })} />
            <Txt label="Expected state" value={entry.expectedState} onChange={(expectedState) => patch(entry.itemId, { expectedState })} />
            <Txt label="Observed state" value={entry.observedState} onChange={(observedState) => patch(entry.itemId, { observedState })} />
          </div>
          <ItemChecks draft={draft} selected={entry.itemIds} onChange={(itemIds) => patch(entry.itemId, { itemIds })} />
          <Txt label="Exception / note" value={entry.exception} onChange={(exception) => patch(entry.itemId, { exception })} />
        </div>
      ))}
    </div>
  );
}

const GAP_LABEL = { GAP: "Control gap (derived)", NO_GAP: "No gap (derived)", UNDETERMINED: "Gap not determinable yet" } as const;
function ControlsEditor({ draft, update }: { draft: CargoDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<CargoDraft["controls"][number]>) => update((d) => ({ ...d, controls: d.controls.map((control) => (control.itemId === itemId ? { ...control, ...change } : control)) }));
  return (
    <div className={sectionClass} data-testid="cargo-controls">
      <Header title="Security controls" hint="Record what was expected and what was found. The gap is derived - you never choose it." action={addButton("Add control", () => update((d) => ({ ...d, controls: [...d.controls, emptyCargoControl()] })))} />
      {draft.controls.length === 0 ? <Empty text="No security controls recorded." /> : draft.controls.map((control) => (
        <div key={control.itemId} className={`${card} sm:grid sm:grid-cols-2 sm:gap-2 sm:space-y-0 lg:grid-cols-[1fr_1.3fr_1.3fr_1fr_1fr_auto] lg:items-end`}>
          <Pick label="Control" required value={control.controlType} options={CARGO_CONTROL_TYPES} onChange={(controlType) => patch(control.itemId, { controlType })} />
          <Pick label="Expected" value={control.expectedState} options={CARGO_CONTROL_STATES} onChange={(expectedState) => patch(control.itemId, { expectedState })} />
          <Pick label="Actual (observed)" value={control.actualState} options={CARGO_CONTROL_STATES} onChange={(actualState) => patch(control.itemId, { actualState })} />
          <Pick label="Source" value={control.source} options={CARGO_MEASUREMENT_SOURCES} onChange={(source) => patch(control.itemId, { source })} />
          <div className="text-[11px] font-semibold"><span className="text-muted-foreground">Result</span><div className="mt-1 text-xs font-bold" data-testid="cargo-control-gap">{GAP_LABEL[deriveCargoControlGap(control)]}</div></div>
          {removeButton(() => update((d) => ({ ...d, controls: d.controls.filter((item) => item.itemId !== control.itemId) })))}
        </div>
      ))}
    </div>
  );
}

/** Lightweight cargo context. The company's usual cargo (Profile > Cargo Information) is offered read-only as a reference; nothing is copied or written back. */
function CargoContext({ facts, setFact, renderField, companyId }: { facts: Record<string, unknown>; setFact: (key: string, value: string | null) => void; renderField: (key: string) => React.ReactNode; companyId: string }) {
  const usual = React.useMemo(() => { try { const company = loadCompanies().find((item) => item.id === companyId) as ({ cargoTypes?: string[] } | undefined); return Array.isArray(company?.cargoTypes) ? company.cargoTypes.filter(Boolean) : []; } catch { return []; } }, [companyId]);
  const description = typeof facts.cargoGeneralDescription === "string" ? facts.cargoGeneralDescription : "";
  return (
    <div className={sectionClass} data-testid="cargo-context">
      <Header title="Cargo context" hint="Optional. This never creates a cargo item." />
      <div className="grid gap-3 sm:grid-cols-2">{renderField("cargoContextStatus")}{renderField("cargoGeneralDescription")}</div>
      {usual.length ? <div className="text-[10px] text-muted-foreground" data-testid="cargo-usual-reference">Usual cargo on the company profile (reference only): {usual.map((type) => <button key={type} type="button" onClick={() => { setFact("cargoContextStatus", "KNOWN_GENERAL"); setFact("cargoGeneralDescription", description ? description : type); }} className="mr-1 mt-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold hover:bg-muted">{type}</button>)}</div> : null}
    </div>
  );
}

const fieldGrid = (keys: string[], renderField: (key: string) => React.ReactNode, className = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3") => <div className={className}>{keys.map((key) => <React.Fragment key={key}>{renderField(key)}</React.Fragment>)}</div>;

export function CargoStepPanel({ stepKey, draft, update, facts, setFact, renderField, companyId }: {
  stepKey: string; draft: CargoDraft; update: Update; facts: Record<string, unknown>; setFact: (key: string, value: string | null) => void; renderField: (key: string) => React.ReactNode; companyId: string;
}) {
  const vehicles = useNearMissVehicles(companyId);
  const title = (text: string, hint: string) => <div><h4 className="text-sm font-bold text-foreground">{text}</h4><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div>;
  const family = typeof facts.primaryFamily === "string" ? facts.primaryFamily : "";
  if (stepKey === "CARGO_SHIPMENT") return (
    <section className="space-y-4">{title("Shipment & Trip", "Operational references as entered. TES has no canonical shipment, load, trip or facility records, so these are free text and no relationship is created.")}
      {fieldGrid(["loadReference", "bolPro", "shipmentReference", "customerName", "shipperName", "receiverName", "brokerName", "originText", "destinationText", "facilitySite", "plannedRouteReference", "actualRouteReference"], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}
    </section>
  );
  if (stepKey === "CARGO_CARRIER") return (
    <section className="space-y-4">{title("Carrier Context", "The driver is this record's driver. Link the canonical Power Unit and any trailers, and say where in the shipment the incident occurred.")}
      <div className={sectionClass} data-testid="cargo-carrier">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] font-semibold text-foreground">Power Unit <span className="text-destructive">*</span>
            <select id="cargo-power-unit" value={draft.powerUnitId} onChange={(e) => update((d) => ({ ...d, powerUnitId: e.target.value }))} className={inputClass}><option value="">Select...</option>{vehicles.powerUnits.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>Unit {vehicle.unitNumber}{vehicle.equipmentType ? ` - ${vehicle.equipmentType}` : ""}</option>)}</select>
            {vehicles.powerUnits.length === 0 ? <span className="mt-1 block text-[10px] text-destructive">No power units on record for this company.</span> : null}
          </label>
          <fieldset className="min-w-0 text-[11px] font-semibold text-foreground"><legend>Trailer(s) / container <span className="font-normal text-muted-foreground">(optional)</span></legend>
            <div className="mt-1 flex flex-wrap gap-1.5">{vehicles.trailers.length === 0 ? <span className="text-[10px] font-normal text-muted-foreground">No trailers on record.</span> : vehicles.trailers.map((vehicle) => <label key={vehicle.id} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${draft.trailerIds.includes(vehicle.id) ? "border-primary bg-primary/5" : "border-border bg-background"}`}><input type="checkbox" className="size-3.5 accent-primary" checked={draft.trailerIds.includes(vehicle.id)} onChange={() => update((d) => ({ ...d, trailerIds: toggle(d.trailerIds, vehicle.id) }))} />Unit {vehicle.unitNumber}</label>)}</div>
          </fieldset>
        </div>
        {fieldGrid(["custodyStage"], renderField, "grid gap-3 sm:grid-cols-2")}
      </div>
    </section>
  );
  if (stepKey === "CARGO_ITEMS") return (
    <section className="space-y-4">{title("Cargo Exposure", "What cargo was involved. Give a general description now if you can, and add detailed items when they are known. Items entered here are the only item list.")}
      <CargoContext facts={facts} setFact={setFact} renderField={renderField} companyId={companyId} />
      <ItemEditor draft={draft} update={update} />
    </section>
  );
  if (stepKey === "CARGO_CLASSIFICATION") {
    const secondaryOptions = CARGO_SECONDARY_BY_FAMILY[family] || [];
    return (
      <section className="space-y-4">{title("Incident Classification", "One primary family characterises the occurrence. Damage and Theft outcomes can still both be recorded.")}
        <div className="grid gap-3 sm:grid-cols-2">
          {renderField("primaryFamily")}
          <Pick label="Secondary Classification" value={typeof facts.secondaryClassification === "string" ? facts.secondaryClassification : ""} options={secondaryOptions} onChange={(value) => setFact("secondaryClassification", value || null)} />
        </div>
        {!family ? <p className="text-[10px] text-muted-foreground">Choose the Primary Incident Family to see its secondary classifications.</p> : null}
        {fieldGrid(["incidentNarrative"], renderField, "grid gap-3")}
      </section>
    );
  }
  if (stepKey === "CARGO_RESPONSE") return (
    <section className="space-y-4">{title("Immediate Response", "What was done straight away. These are facts, not Company Actions; leave blank when not recorded.")}
      {fieldGrid([...CARGO_RESPONSE_FACT_KEYS], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}
    </section>
  );
  if (stepKey === "CARGO_OUTCOMES") return <section className="space-y-4">{title("Damage & Theft", "Optional outcome modules of this one incident. Add either, both or neither.")}<DamageModule draft={draft} update={update} /><TheftModule draft={draft} update={update} /><TemperatureModule draft={draft} update={update} /></section>;
  if (stepKey === "CARGO_CUSTODY") return <section className="space-y-4">{title("Custody & Security", "Chain of custody, the last known good and first anomaly, and individual security controls.")}<CustodyEditor draft={draft} update={update} vehicles={vehicles} /><ControlsEditor draft={draft} update={update} /></section>;
  return null;
}

/** Evidence stays on the event once; this block only links existing evidence to child records. */
export function CargoEvidencePanel({ draft, update, evidence }: { draft: CargoDraft; update: Update; evidence: CargoEvidenceChoice[] }) {
  const links: Array<{ key: string; label: string; ids: string[]; set: (ids: string[]) => void }> = [
    ...draft.items.map((item) => ({ key: item.itemId, label: `Item: ${item.commodity || "Unnamed"}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, items: d.items.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...(draft.damage ? [{ key: "damage", label: "Damage outcome", ids: draft.damage.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, damage: d.damage ? { ...d.damage, evidenceIds: ids } : d.damage })) }] : []),
    ...(draft.theft ? [{ key: "theft", label: "Theft outcome", ids: draft.theft.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, theft: d.theft ? { ...d.theft, evidenceIds: ids } : d.theft })) }] : []),
    ...draft.temperatures.map((obs, index) => ({ key: obs.itemId, label: `Temperature observation ${index + 1}`, ids: obs.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, temperatures: d.temperatures.map((x) => (x.itemId === obs.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.custody.map((entry) => ({ key: entry.itemId, label: `Custody ${entry.ordinal || "?"}: ${cargoOptionLabel(CARGO_CUSTODY_ROLES, entry.role)}`, ids: entry.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, custody: d.custody.map((x) => (x.itemId === entry.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.controls.map((control) => ({ key: control.itemId, label: `Control: ${cargoOptionLabel(CARGO_CONTROL_TYPES, control.controlType) || "Unspecified"}`, ids: control.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, controls: d.controls.map((x) => (x.itemId === control.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
  ];
  return (
    <div className={sectionClass} data-testid="cargo-evidence-panel">
      <Header title="Evidence references" hint="Evidence is stored once for the Cargo Incident. Tick the evidence that supports each record; nothing is copied." />
      {evidence.length === 0 ? <Empty text="Add evidence above first, then link it to records here." /> : links.length === 0 ? <Empty text="No records to link yet." /> : (
        <div className="space-y-2">{links.map((link) => (
          <div key={link.key} className="rounded-lg border border-border bg-background p-2"><div className="text-[11px] font-bold">{link.label}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">{evidence.map((item) => <label key={item.id} className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] ${link.ids.includes(item.id) ? "border-primary bg-primary/5" : "border-border"}`}><input type="checkbox" className="size-3 accent-primary" checked={link.ids.includes(item.id)} onChange={() => link.set(toggle(link.ids, item.id))} />{item.label}</label>)}</div></div>
        ))}</div>
      )}
    </div>
  );
}

export function CargoReviewBlock({ draft, vehicles }: { draft: CargoDraft; vehicles: { powerUnits: Array<{ id: string; unitNumber: string }>; trailers: Array<{ id: string; unitNumber: string }> } }) {
  const unit = (id: string) => `Unit ${[...vehicles.powerUnits, ...vehicles.trailers].find((vehicle) => vehicle.id === id)?.unitNumber || id}`;
  const row = (name: string, value: string) => <div className="flex justify-between gap-4 text-xs"><span className="text-muted-foreground">{name}</span><span className="text-right font-semibold">{value || "None"}</span></div>;
  return (
    <div className="space-y-2 rounded-xl border border-border p-4" data-testid="cargo-review">
      <div className="mb-1 text-xs font-bold">Cargo Incident Records</div>
      {row("Occurrence precision", cargoOptionLabel(CARGO_OCCURRENCE_PRECISIONS, draft.precision))}
      {row("Power Unit", draft.powerUnitId ? unit(draft.powerUnitId) : "")}
      {row("Trailer(s)", draft.trailerIds.map(unit).join(", "))}
      {row("Cargo items", draft.items.map((item) => item.commodity || "Unnamed").join(", "))}
      {row("Damage outcome", draft.damage ? "Recorded" : "")}
      {row("Theft outcome", draft.theft ? "Recorded" : "")}
      {row("Temperature observations", String(draft.temperatures.length))}
      {row("Custody records", String(draft.custody.length))}
      {row("Security controls", String(draft.controls.length))}
    </div>
  );
}
