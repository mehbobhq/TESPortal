"use client";

import React from "react";
import {
  SPILL_ACCESS_CLASSES, SPILL_ASSESSMENT_STATUSES, SPILL_CURRENCIES, SPILL_ENVIRONMENTAL_MEDIA, SPILL_ESTIMATION_METHODS, SPILL_EXECUTION_STATUSES, SPILL_EXPOSURE_ROUTES, SPILL_EXPOSURE_STATUSES, SPILL_IDENTIFICATION_STATUSES,
  SPILL_IMPACT_STATUSES, SPILL_MATERIAL_CATEGORIES, SPILL_MATERIAL_SOURCES, SPILL_MEDICAL_EVALUATIONS, SPILL_OCCURRENCE_PRECISIONS, SPILL_PACKING_GROUPS, SPILL_PERSON_ROLES, SPILL_PHYSICAL_STATES, SPILL_QUANTITY_DIMENSIONS,
  SPILL_QUANTITY_STATUSES, SPILL_QUANTITY_UNITS, SPILL_RESPONSE_ACTIONS, SPILL_RESTORATION_STATUSES, SPILL_SDS_STATUSES, SPILL_SHIPPING_PAPER_STATUSES, SPILL_STEP_SOURCES, SPILL_VERIFICATION_STATUSES, SPILL_YES_NO_UNKNOWN,
  spillOptionLabel, type SpillOption,
} from "@/lib/performance-spill-taxonomy";
import {
  SPILL_IMPACT_FACT_KEYS, SPILL_RESPONSE_FACT_KEYS, SPILL_RISK_FACT_KEYS, emptySpillCleanup, emptySpillMaterial, emptySpillMedium, emptySpillObligation, emptySpillPerson, emptySpillQuantity, emptySpillStep,
  type SpillDraft, type SpillDraftMaterial,
} from "@/lib/performance-spill";
import { useNearMissVehicles } from "./NearMissWizardPanels";

const inputClass = "mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";
const sectionClass = "space-y-3 rounded-xl border border-border bg-muted/10 p-4";
const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

type Update = (updater: (draft: SpillDraft) => SpillDraft) => void;
export interface SpillEvidenceChoice { id: string; label: string }

function Pick({ label, value, options, onChange, required, className = "" }: { label: string; value: string; options: readonly SpillOption[]; onChange: (value: string) => void; required?: boolean; className?: string }) {
  return <label className={`block min-w-0 text-[11px] font-semibold text-foreground ${className}`}>{label}{required ? <span className="text-destructive"> *</span> : null}<select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}><option value="">Select...</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
function Txt({ label, value, onChange, type = "text", required, placeholder, className = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string; className?: string }) {
  return <label className={`block min-w-0 text-[11px] font-semibold text-foreground ${className}`}>{label}{required ? <span className="text-destructive"> *</span> : null}<input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} /></label>;
}
function Money({ label, value, currency, onValue, onCurrency }: { label: string; value: string; currency: string; onValue: (value: string) => void; onCurrency: (value: string) => void }) {
  return <div className="min-w-0 text-[11px] font-semibold text-foreground"><span>{label}</span><div className="mt-1 flex gap-1.5"><input aria-label={label} type="number" min="0" step="0.01" value={value} onChange={(e) => onValue(e.target.value)} className={`${inputClass} !mt-0`} /><select aria-label={`${label} currency`} value={currency} onChange={(e) => onCurrency(e.target.value)} className={`${inputClass} !mt-0 w-20`}>{SPILL_CURRENCIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div>;
}
const Header = ({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) => <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h5 className="text-xs font-bold text-foreground">{title}</h5>{hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}</div>{action}</div>;
const addButton = (label: string, onClick: () => void, testId?: string) => <button type="button" data-testid={testId} onClick={onClick} className="rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-bold hover:bg-muted">{label}</button>;
const removeButton = (onClick: () => void) => <button type="button" onClick={onClick} className="justify-self-end text-[10px] font-bold text-destructive hover:underline">Remove</button>;
const Empty = ({ text }: { text: string }) => <p className="rounded-lg border border-dashed border-border p-2.5 text-[11px] text-muted-foreground">{text}</p>;
const card = "space-y-2 rounded-lg border border-border bg-background p-2.5";
const grid = (cols = "sm:grid-cols-2 lg:grid-cols-4") => `grid gap-2 ${cols}`;
const fieldGrid = (keys: readonly string[], renderField: (key: string) => React.ReactNode, className = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3") => <div className={className}>{keys.map((key) => <React.Fragment key={key}>{renderField(key)}</React.Fragment>)}</div>;
const materialName = (material: SpillDraftMaterial, index: number) => material.description || spillOptionLabel(SPILL_MATERIAL_CATEGORIES, material.category) || `Material ${index + 1}`;

/** Occurrence extras: precision, estimated window, discovery, reported time and time zone. Derived delays are never stored. */
export function SpillOccurrenceExtras({ draft, update, facts, setFact, renderField }: { draft: SpillDraft; update: Update; facts: Record<string, unknown>; setFact: (key: string, value: string | null) => void; renderField: (key: string) => React.ReactNode }) {
  const val = (key: string) => (typeof facts[key] === "string" ? (facts[key] as string) : "");
  return (
    <div className={sectionClass} data-testid="spill-occurrence-extras">
      <Header title="Occurrence precision, discovery and report" hint="Occurrence, discovery and report are separate. Unknown or approximate values are kept as such; an exact time is never assumed." />
      <div className={grid()}>
        <Pick label="Occurrence precision" required value={draft.precision} options={SPILL_OCCURRENCE_PRECISIONS} onChange={(precision) => update((d) => ({ ...d, precision }))} />
        <Txt label="Estimated window - start" type="datetime-local" value={val("occurrenceWindowStart")} onChange={(v) => setFact("occurrenceWindowStart", v || null)} />
        <Txt label="Estimated window - end" type="datetime-local" value={val("occurrenceWindowEnd")} onChange={(v) => setFact("occurrenceWindowEnd", v || null)} />
        <Txt label="Basis for the window" value={val("occurrenceWindowBasis")} onChange={(v) => setFact("occurrenceWindowBasis", v || null)} />
        <Txt label="Discovery date" type="date" value={val("discoveryDate")} onChange={(v) => setFact("discoveryDate", v || null)} />
        <Txt label="Discovery time" type="time" value={val("discoveryTime")} onChange={(v) => setFact("discoveryTime", v || null)} />
        <Txt label="Reported time" type="time" value={val("reportedTime")} onChange={(v) => setFact("reportedTime", v || null)} />
        {renderField("eventTimeZone")}
      </div>
    </div>
  );
}

function MaterialEditor({ draft, update }: { draft: SpillDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<SpillDraftMaterial>) => update((d) => ({ ...d, materials: d.materials.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  return (
    <div className={sectionClass} data-testid="spill-materials">
      <Header title="Materials" hint="Record what was observed. An unknown or pending material is valid. The operational category is not the regulatory identity." action={<div className="flex gap-1.5">{addButton("Add material", () => update((d) => ({ ...d, materials: [...d.materials, emptySpillMaterial()] })), "spill-add-material")}{addButton("Unknown substance", () => update((d) => ({ ...d, materials: [...d.materials, { ...emptySpillMaterial(), category: "UNKNOWN", description: "Unknown substance", identificationStatus: "UNKNOWN" }] })), "spill-add-unknown")}</div>} />
      {draft.materials.length === 0 ? <Empty text="No material recorded yet. You can continue now and add it when it is known." /> : draft.materials.map((material, index) => {
        const identityLocked = material.identificationStatus === "UNKNOWN" || material.identificationStatus === "PENDING_IDENTIFICATION";
        return (
          <div key={material.itemId} className={card}>
            <div className="flex items-center justify-between"><span className="text-[11px] font-bold">Material {index + 1}</span>{removeButton(() => update((d) => ({ ...d, materials: d.materials.filter((entry) => entry.itemId !== material.itemId), quantities: d.quantities.map((entry) => (entry.materialId === material.itemId ? { ...entry, materialId: "" } : entry)), cleanups: d.cleanups.map((entry) => (entry.materialId === material.itemId ? { ...entry, materialId: "" } : entry)) })))}</div>
            <div className={grid()}>
              <Txt label="What was observed" required value={material.description} onChange={(description) => patch(material.itemId, { description })} className="sm:col-span-2" />
              <Pick label="Operational category" value={material.category} options={SPILL_MATERIAL_CATEGORIES} onChange={(category) => patch(material.itemId, { category })} />
              <Pick label="Identification status" required value={material.identificationStatus} options={SPILL_IDENTIFICATION_STATUSES} onChange={(identificationStatus) => patch(material.itemId, { identificationStatus, ...(identificationStatus === "UNKNOWN" || identificationStatus === "PENDING_IDENTIFICATION" ? { properShippingName: "", unId: "", hazardClass: "", packingGroup: "" } : {}) })} />
              <Pick label="Identification source" value={material.materialSource} options={SPILL_MATERIAL_SOURCES} onChange={(materialSource) => patch(material.itemId, { materialSource })} />
              <Pick label="Physical state" value={material.physicalState} options={SPILL_PHYSICAL_STATES} onChange={(physicalState) => patch(material.itemId, { physicalState })} />
            </div>
            <details open={Boolean(material.properShippingName || material.unId || material.hazardClass || material.packingGroup)}><summary className="cursor-pointer text-[10px] font-bold text-muted-foreground">Regulatory identity and documents (only what is actually known)</summary>
              <div className="mt-2 space-y-2">
                {identityLocked ? <p className="text-[10px] text-muted-foreground" data-testid="spill-identity-locked">Identity fields stay empty while the material is Unknown or Pending Identification. Change the status once it is established.</p> : null}
                <div className={grid()}>
                  <Txt label="Proper shipping name" value={material.properShippingName} onChange={(properShippingName) => patch(material.itemId, { properShippingName })} className="sm:col-span-2" />
                  <Txt label="Technical / trade name" value={material.technicalName} onChange={(technicalName) => patch(material.itemId, { technicalName })} />
                  <Txt label="UN / ID" value={material.unId} onChange={(unId) => patch(material.itemId, { unId })} />
                  <Txt label="Hazard class / division" value={material.hazardClass} onChange={(hazardClass) => patch(material.itemId, { hazardClass })} />
                  <Pick label="Packing group" value={material.packingGroup} options={SPILL_PACKING_GROUPS} onChange={(packingGroup) => patch(material.itemId, { packingGroup })} />
                  <Pick label="SDS" value={material.sdsStatus} options={SPILL_SDS_STATUSES} onChange={(sdsStatus) => patch(material.itemId, { sdsStatus })} />
                  <Txt label="SDS reference" value={material.sdsReference} onChange={(sdsReference) => patch(material.itemId, { sdsReference })} />
                  <Pick label="Placard required" value={material.placardRequired} options={SPILL_YES_NO_UNKNOWN} onChange={(placardRequired) => patch(material.itemId, { placardRequired })} />
                  <Pick label="Placard displayed" value={material.placardDisplayed} options={SPILL_YES_NO_UNKNOWN} onChange={(placardDisplayed) => patch(material.itemId, { placardDisplayed })} />
                  <Pick label="Shipping papers" value={material.shippingPapersStatus} options={SPILL_SHIPPING_PAPER_STATUSES} onChange={(shippingPapersStatus) => patch(material.itemId, { shippingPapersStatus })} />
                  <Txt label="Notes" value={material.notes} onChange={(notes) => patch(material.itemId, { notes })} className="sm:col-span-2" />
                </div>
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
}

function QuantityEditor({ draft, update }: { draft: SpillDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<SpillDraft["quantities"][number]>) => update((d) => ({ ...d, quantities: d.quantities.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  const materials = draft.materials.map((material, index) => ({ value: material.itemId, label: materialName(material, index) }));
  return (
    <div className={sectionClass} data-testid="spill-quantities">
      <Header title="Quantities" hint="Optional. Leave a value blank when it is not known - blank is never zero. A value needs a unit and a status." action={addButton("Add quantity", () => update((d) => ({ ...d, quantities: [...d.quantities, emptySpillQuantity()] })), "spill-add-quantity")} />
      {draft.quantities.length === 0 ? <Empty text="Released quantity not established." /> : draft.quantities.map((quantity) => (
        <div key={quantity.itemId} className={card}>
          <div className="flex items-center justify-end">{removeButton(() => update((d) => ({ ...d, quantities: d.quantities.filter((entry) => entry.itemId !== quantity.itemId) })))}</div>
          <div className={grid("sm:grid-cols-2 lg:grid-cols-6")}>
            <Pick label="Quantity type" required value={quantity.dimension} options={SPILL_QUANTITY_DIMENSIONS} onChange={(dimension) => patch(quantity.itemId, { dimension })} />
            <Pick label="Material (optional)" value={quantity.materialId} options={materials} onChange={(materialId) => patch(quantity.itemId, { materialId })} />
            <Txt label="Value" type="number" value={quantity.value} onChange={(value) => patch(quantity.itemId, { value, ...(value === "" ? { unit: "" } : {}) })} />
            <Pick label="Unit" value={quantity.unit} options={SPILL_QUANTITY_UNITS} onChange={(unit) => patch(quantity.itemId, { unit })} />
            <Pick label="Status" value={quantity.status} options={SPILL_QUANTITY_STATUSES} onChange={(status) => patch(quantity.itemId, { status })} />
            <Pick label="Estimation method" value={quantity.method} options={SPILL_ESTIMATION_METHODS} onChange={(method) => patch(quantity.itemId, { method })} />
            <Txt label="Notes" value={quantity.notes} onChange={(notes) => patch(quantity.itemId, { notes })} className="sm:col-span-2 lg:col-span-6" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PersonEditor({ draft, update }: { draft: SpillDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<SpillDraft["persons"][number]>) => update((d) => ({ ...d, persons: d.persons.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  return (
    <div className={sectionClass} data-testid="spill-persons">
      <Header title="People exposed or affected" hint="Consequence of this release only. Counts are derived from these records. Medical details need an access classification." action={addButton("Add person", () => update((d) => ({ ...d, persons: [...d.persons, emptySpillPerson()] })), "spill-add-person")} />
      {draft.persons.length === 0 ? <Empty text="No person records." /> : draft.persons.map((person, index) => (
        <div key={person.itemId} className={card}>
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold">Person {index + 1}</span>{removeButton(() => update((d) => ({ ...d, persons: d.persons.filter((entry) => entry.itemId !== person.itemId) })))}</div>
          <div className={grid()}>
            <Pick label="Role" required value={person.role} options={SPILL_PERSON_ROLES} onChange={(role) => patch(person.itemId, { role, ...(role === "CARRIER_DRIVER" ? {} : { isEventDriver: false }) })} />
            <Txt label="Name (optional)" value={person.name} onChange={(name) => patch(person.itemId, { name })} />
            <Pick label="Exposure" value={person.exposureStatus} options={SPILL_EXPOSURE_STATUSES} onChange={(exposureStatus) => patch(person.itemId, { exposureStatus })} />
            <Pick label="Exposure route" value={person.exposureRoute} options={SPILL_EXPOSURE_ROUTES} onChange={(exposureRoute) => patch(person.itemId, { exposureRoute })} />
            <Pick label="Symptoms reported" value={person.symptomsReported} options={SPILL_YES_NO_UNKNOWN} onChange={(symptomsReported) => patch(person.itemId, { symptomsReported })} />
            <Pick label="Injury status" value={person.injuryStatus} options={SPILL_YES_NO_UNKNOWN} onChange={(injuryStatus) => patch(person.itemId, { injuryStatus, ...(injuryStatus === "YES" ? {} : { injuryDescription: "" }) })} />
            {person.injuryStatus === "YES" ? <Txt label="Injury description (optional)" value={person.injuryDescription} onChange={(injuryDescription) => patch(person.itemId, { injuryDescription })} className="sm:col-span-2" /> : null}
            <Pick label="First aid" value={person.firstAid} options={SPILL_YES_NO_UNKNOWN} onChange={(firstAid) => patch(person.itemId, { firstAid })} />
            <Pick label="Medical evaluation" value={person.medicalEvaluation} options={SPILL_MEDICAL_EVALUATIONS} onChange={(medicalEvaluation) => patch(person.itemId, { medicalEvaluation })} />
            <Pick label="Transported" value={person.transported} options={SPILL_YES_NO_UNKNOWN} onChange={(transported) => patch(person.itemId, { transported })} />
            <Pick label="Hospitalized" value={person.hospitalized} options={SPILL_YES_NO_UNKNOWN} onChange={(hospitalized) => patch(person.itemId, { hospitalized })} />
            <Pick label="Fatality" value={person.fatality} options={SPILL_YES_NO_UNKNOWN} onChange={(fatality) => patch(person.itemId, { fatality })} />
            <Pick label="Access classification" value={person.accessClassification} options={SPILL_ACCESS_CLASSES} onChange={(accessClassification) => patch(person.itemId, { accessClassification })} />
            <Txt label="Notes" value={person.notes} onChange={(notes) => patch(person.itemId, { notes })} />
          </div>
          {person.role === "CARRIER_DRIVER" ? <label className="flex items-center gap-1.5 text-[11px] font-semibold"><input type="checkbox" className="size-3.5 accent-primary" checked={person.isEventDriver} onChange={(e) => patch(person.itemId, { isEventDriver: e.target.checked })} />This is the driver on this event</label> : null}
        </div>
      ))}
    </div>
  );
}

function MediaEditor({ draft, update }: { draft: SpillDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<SpillDraft["media"][number]>) => update((d) => ({ ...d, media: d.media.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  const used = draft.media.map((entry) => entry.medium);
  return (
    <div className={sectionClass} data-testid="spill-media">
      <Header title="Environmental impact" hint="One record per medium. Suspected stays suspected; a risk fact below is not confirmed impact." action={addButton("Add medium", () => update((d) => ({ ...d, media: [...d.media, emptySpillMedium()] })), "spill-add-medium")} />
      {draft.media.length === 0 ? <Empty text="No environmental medium recorded." /> : draft.media.map((entry) => (
        <div key={entry.itemId} className={card}>
          <div className={grid("sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto] lg:items-end")}>
            <Pick label="Medium" required value={entry.medium} options={SPILL_ENVIRONMENTAL_MEDIA.filter((option) => option.value === entry.medium || !used.includes(option.value))} onChange={(medium) => patch(entry.itemId, { medium })} />
            <Pick label="Impact status" required value={entry.impactStatus} options={SPILL_IMPACT_STATUSES} onChange={(impactStatus) => patch(entry.itemId, { impactStatus })} />
            <Txt label="Note" value={entry.note} onChange={(note) => patch(entry.itemId, { note })} />
            {removeButton(() => update((d) => ({ ...d, media: d.media.filter((item) => item.itemId !== entry.itemId) })))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineEditor({ draft, update }: { draft: SpillDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<SpillDraft["steps"][number]>) => update((d) => ({ ...d, steps: d.steps.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  return (
    <div className={sectionClass} data-testid="spill-timeline">
      <Header title="Response timeline" hint="Ordered by the sequence number. Enter actual times; notification, containment and cleanup durations are derived later, never entered." action={addButton("Add step", () => update((d) => ({ ...d, steps: [...d.steps, emptySpillStep(Math.max(0, ...d.steps.map((entry) => Number(entry.ordinal) || 0)) + 1)] })), "spill-add-step")} />
      {draft.steps.length === 0 ? <Empty text="No response steps recorded." /> : draft.steps.map((entry) => (
        <div key={entry.itemId} className={card}>
          <div className={grid("sm:grid-cols-2 lg:grid-cols-[4.5rem_1.4fr_1.2fr_1fr_auto] lg:items-end")}>
            <Txt label="No." type="number" value={entry.ordinal} onChange={(ordinal) => patch(entry.itemId, { ordinal })} />
            <Pick label="Action" required value={entry.action} options={SPILL_RESPONSE_ACTIONS} onChange={(action) => patch(entry.itemId, { action, ...(action === "OTHER" ? {} : { actionOther: "" }) })} />
            <Txt label="Date / time" type="datetime-local" value={entry.timestamp} onChange={(timestamp) => patch(entry.itemId, { timestamp })} />
            <Pick label="Source" value={entry.source} options={SPILL_STEP_SOURCES} onChange={(source) => patch(entry.itemId, { source })} />
            {removeButton(() => update((d) => ({ ...d, steps: d.steps.filter((item) => item.itemId !== entry.itemId) })))}
          </div>
          <div className={grid("sm:grid-cols-2 lg:grid-cols-3")}>
            {entry.action === "OTHER" ? <Txt label="Describe the action" required value={entry.actionOther} onChange={(actionOther) => patch(entry.itemId, { actionOther })} /> : null}
            <Txt label="Actor (free text)" value={entry.actor} onChange={(actor) => patch(entry.itemId, { actor })} />
            <Txt label="Location" value={entry.location} onChange={(location) => patch(entry.itemId, { location })} />
            <Txt label="Notes" value={entry.notes} onChange={(notes) => patch(entry.itemId, { notes })} className="sm:col-span-2 lg:col-span-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CleanupEditor({ draft, update }: { draft: SpillDraft; update: Update }) {
  const patch = (itemId: string, change: Partial<SpillDraft["cleanups"][number]>) => update((d) => ({ ...d, cleanups: d.cleanups.map((item) => (item.itemId === itemId ? { ...item, ...change } : item)) }));
  const materials = draft.materials.map((material, index) => ({ value: material.itemId, label: materialName(material, index) }));
  return (
    <div className={sectionClass} data-testid="spill-cleanups">
      <Header title="Cleanup records" hint="Optional at first report. Detailed cleanup, disposal and verification are added as they happen." action={addButton("Add cleanup record", () => update((d) => ({ ...d, cleanups: [...d.cleanups, emptySpillCleanup()] })), "spill-add-cleanup")} />
      {draft.cleanups.length === 0 ? <Empty text="No detailed cleanup record." /> : draft.cleanups.map((entry, index) => (
        <div key={entry.itemId} className={card}>
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold">Cleanup {index + 1}</span>{removeButton(() => update((d) => ({ ...d, cleanups: d.cleanups.filter((item) => item.itemId !== entry.itemId) })))}</div>
          <div className={grid()}>
            <Txt label="Vendor" value={entry.vendor} onChange={(vendor) => patch(entry.itemId, { vendor })} />
            <Txt label="Response / cleanup method" value={entry.method} onChange={(method) => patch(entry.itemId, { method })} className="sm:col-span-2" />
            <Txt label="Started" type="datetime-local" value={entry.startedAt} onChange={(startedAt) => patch(entry.itemId, { startedAt })} />
            <Txt label="Completed" type="datetime-local" value={entry.completedAt} onChange={(completedAt) => patch(entry.itemId, { completedAt })} />
            <Pick label="Material removed" value={entry.materialId} options={materials} onChange={(materialId) => patch(entry.itemId, { materialId })} />
            <Txt label="Removed (free text)" value={entry.materialRemoved} onChange={(materialRemoved) => patch(entry.itemId, { materialRemoved })} />
            <Txt label="Quantity removed" type="number" value={entry.quantityRemoved} onChange={(quantityRemoved) => patch(entry.itemId, { quantityRemoved })} />
            <Pick label="Unit" value={entry.quantityUnit} options={SPILL_QUANTITY_UNITS} onChange={(quantityUnit) => patch(entry.itemId, { quantityUnit })} />
          </div>
          <details><summary className="cursor-pointer text-[10px] font-bold text-muted-foreground">Disposal, restoration, verification and cost</summary>
            <div className={`mt-2 ${grid()}`}>
              <Txt label="Disposal method" value={entry.disposalMethod} onChange={(disposalMethod) => patch(entry.itemId, { disposalMethod })} />
              <Txt label="Disposal manifest / reference" value={entry.disposalManifest} onChange={(disposalManifest) => patch(entry.itemId, { disposalManifest })} />
              <Txt label="Waste classification (as stated)" value={entry.wasteClassification} onChange={(wasteClassification) => patch(entry.itemId, { wasteClassification })} />
              <Pick label="Site restoration" value={entry.restorationStatus} options={SPILL_RESTORATION_STATUSES} onChange={(restorationStatus) => patch(entry.itemId, { restorationStatus })} />
              <Pick label="Verification" value={entry.verificationStatus} options={SPILL_VERIFICATION_STATUSES} onChange={(verificationStatus) => patch(entry.itemId, { verificationStatus })} />
              <Txt label="Verification note" value={entry.verificationNote} onChange={(verificationNote) => patch(entry.itemId, { verificationNote })} className="sm:col-span-2" />
              <Money label="Cost" value={entry.cost} currency={entry.costCurrency} onValue={(cost) => patch(entry.itemId, { cost })} onCurrency={(costCurrency) => patch(entry.itemId, { costCurrency })} />
              <Txt label="Notes" value={entry.notes} onChange={(notes) => patch(entry.itemId, { notes })} className="sm:col-span-2" />
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

function FinancialBlock({ draft, update }: { draft: SpillDraft; update: Update }) {
  const patch = (change: Partial<SpillDraft["financial"]>) => update((d) => ({ ...d, financial: { ...d.financial, ...change } }));
  const f = draft.financial;
  return (
    <div className={sectionClass} data-testid="spill-financial">
      <Header title="Financial facts (raw amounts)" hint="Optional. Amounts are recorded as stated. No total, claim, reserve or net loss is calculated." />
      <div className={grid()}>
        <Money label="Material value" value={f.materialValue} currency={f.materialValueCurrency} onValue={(materialValue) => patch({ materialValue })} onCurrency={(materialValueCurrency) => patch({ materialValueCurrency })} />
        <Money label="Cleanup cost" value={f.cleanupCost} currency={f.cleanupCostCurrency} onValue={(cleanupCost) => patch({ cleanupCost })} onCurrency={(cleanupCostCurrency) => patch({ cleanupCostCurrency })} />
        <Money label="Remediation / environmental cost" value={f.remediationCost} currency={f.remediationCostCurrency} onValue={(remediationCost) => patch({ remediationCost })} onCurrency={(remediationCostCurrency) => patch({ remediationCostCurrency })} />
        <Money label="Repair cost" value={f.repairCost} currency={f.repairCostCurrency} onValue={(repairCost) => patch({ repairCost })} onCurrency={(repairCostCurrency) => patch({ repairCostCurrency })} />
      </div>
    </div>
  );
}

function ObligationEditor({ draft, update }: { draft: SpillDraft; update: Update }) {
  const patch = (assessmentId: string, change: Partial<SpillDraft["obligations"][number]>) => update((d) => ({ ...d, obligations: d.obligations.map((item) => (item.assessmentId === assessmentId ? { ...item, ...change } : item)) }));
  return (
    <div className={sectionClass} data-testid="spill-obligations">
      <Header title="Regulatory obligations" hint="Optional. TES applies no legal thresholds: an assessment is a reviewer fact you record, and deadlines are entered as stated. Not recording an obligation is not an obligation." action={addButton("Add obligation", () => update((d) => ({ ...d, obligations: [...d.obligations, emptySpillObligation()] })), "spill-add-obligation")} />
      {draft.obligations.length === 0 ? <Empty text="Regulatory assessment not recorded." /> : draft.obligations.map((entry, index) => (
        <div key={entry.assessmentId} className={card}>
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold">Obligation {index + 1}</span>{removeButton(() => update((d) => ({ ...d, obligations: d.obligations.filter((item) => item.assessmentId !== entry.assessmentId) })))}</div>
          <div className={grid()}>
            <Txt label="Jurisdiction" value={entry.jurisdiction} onChange={(jurisdiction) => patch(entry.assessmentId, { jurisdiction })} />
            <Txt label="Authority" value={entry.authority} onChange={(authority) => patch(entry.assessmentId, { authority })} />
            <Txt label="Reporting / notification basis (as stated)" value={entry.basis} onChange={(basis) => patch(entry.assessmentId, { basis })} />
            <Pick label="Assessment status" required value={entry.assessmentStatus} options={SPILL_ASSESSMENT_STATUSES} onChange={(assessmentStatus) => patch(entry.assessmentId, { assessmentStatus })} />
          </div>
          <details open={Boolean(entry.notificationRequired || entry.reportRequired)}><summary className="cursor-pointer text-[10px] font-bold text-muted-foreground">Execution: notification and report</summary>
            <div className={`mt-2 ${grid()}`}>
              <Pick label="Notification required" value={entry.notificationRequired} options={SPILL_YES_NO_UNKNOWN} onChange={(notificationRequired) => patch(entry.assessmentId, { notificationRequired })} />
              <Txt label="Notification deadline" type="datetime-local" value={entry.notificationDeadline} onChange={(notificationDeadline) => patch(entry.assessmentId, { notificationDeadline })} />
              <Pick label="Notification status" value={entry.notificationStatus} options={SPILL_EXECUTION_STATUSES} onChange={(notificationStatus) => patch(entry.assessmentId, { notificationStatus })} />
              <Txt label="Notified at" type="datetime-local" value={entry.notifiedAt} onChange={(notifiedAt) => patch(entry.assessmentId, { notifiedAt })} />
              <Pick label="Report required" value={entry.reportRequired} options={SPILL_YES_NO_UNKNOWN} onChange={(reportRequired) => patch(entry.assessmentId, { reportRequired })} />
              <Txt label="Report deadline" type="datetime-local" value={entry.reportDeadline} onChange={(reportDeadline) => patch(entry.assessmentId, { reportDeadline })} />
              <Pick label="Report status" value={entry.reportStatus} options={SPILL_EXECUTION_STATUSES} onChange={(reportStatus) => patch(entry.assessmentId, { reportStatus })} />
              <Txt label="Submitted at" type="datetime-local" value={entry.submittedAt} onChange={(submittedAt) => patch(entry.assessmentId, { submittedAt })} />
              <Txt label="Report / control number" value={entry.reportControlNumber} onChange={(reportControlNumber) => patch(entry.assessmentId, { reportControlNumber })} />
              <Txt label="Submission reference" value={entry.submissionReference} onChange={(submissionReference) => patch(entry.assessmentId, { submissionReference })} />
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

export function SpillStepPanel({ stepKey, draft, update, facts, setFact, renderField, companyId }: {
  stepKey: string; draft: SpillDraft; update: Update; facts: Record<string, unknown>; setFact: (key: string, value: string | null) => void; renderField: (key: string) => React.ReactNode; companyId: string;
}) {
  const vehicles = useNearMissVehicles(companyId);
  const title = (text: string, hint: string) => <div><h4 className="text-sm font-bold text-foreground">{text}</h4><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div>;
  void setFact;
  if (stepKey === "SPILL_MATERIAL") return <section className="space-y-4">{title("Material", "What was released, as far as it is known. You do not need a UN number, class or exact identity to record the occurrence.")}<MaterialEditor draft={draft} update={update} /></section>;
  if (stepKey === "SPILL_RELEASE") return (
    <section className="space-y-4">{title("Release", "The release determination, condition and cleanup status are separate. The mechanism is what was observed - it is not the root cause.")}
      <div className={sectionClass} data-testid="spill-release-facts">
        {fieldGrid(["releaseDetermination", "releaseCondition", "releaseForm", "releaseMechanism"], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}
        {facts.releaseMechanism === "OTHER" ? fieldGrid(["releaseMechanismOther"], renderField, "grid gap-3 sm:grid-cols-2") : null}
      </div>
      <div className={sectionClass} data-testid="spill-source">
        <Header title="Release source and carrier" hint="Subsystem and component are free text. The Power Unit and trailers are optional canonical links." />
        {fieldGrid(["sourceCategory", "sourceSubsystem", "sourceComponent"], renderField, "grid gap-3 sm:grid-cols-3")}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] font-semibold text-foreground">Power Unit <span className="font-normal text-muted-foreground">(optional)</span>
            <select id="spill-power-unit" value={draft.powerUnitId} onChange={(e) => update((d) => ({ ...d, powerUnitId: e.target.value }))} className={inputClass}><option value="">None / not applicable</option>{vehicles.powerUnits.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>Unit {vehicle.unitNumber}{vehicle.equipmentType ? ` - ${vehicle.equipmentType}` : ""}</option>)}</select>
          </label>
          <fieldset className="min-w-0 text-[11px] font-semibold text-foreground"><legend>Trailer(s) <span className="font-normal text-muted-foreground">(optional)</span></legend>
            <div className="mt-1 flex flex-wrap gap-1.5">{vehicles.trailers.length === 0 ? <span className="text-[10px] font-normal text-muted-foreground">No trailers on record.</span> : vehicles.trailers.map((vehicle) => <label key={vehicle.id} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${draft.trailerIds.includes(vehicle.id) ? "border-primary bg-primary/5" : "border-border bg-background"}`}><input type="checkbox" className="size-3.5 accent-primary" checked={draft.trailerIds.includes(vehicle.id)} onChange={() => update((d) => ({ ...d, trailerIds: toggle(d.trailerIds, vehicle.id) }))} />Unit {vehicle.unitNumber}</label>)}</div>
          </fieldset>
        </div>
      </div>
      <QuantityEditor draft={draft} update={update} />
      {fieldGrid(["responseNotes"], renderField, "grid gap-3")}
    </section>
  );
  if (stepKey === "SPILL_OPERATIONS") return (
    <section className="space-y-4">{title("Shipment & Operations", "Operational references as entered. TES has no canonical shipment, trip, customer or facility records, so these are free text and no relationship is created.")}
      {fieldGrid(["loadReference", "bolPro", "shipmentReference", "customerName", "shipperName", "receiverName", "originText", "destinationText", "facilitySite", "routeReference", "operatingStage"], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}
    </section>
  );
  if (stepKey === "SPILL_IMPACT") return (
    <section className="space-y-4">{title("Impact", "People, environment and operational consequences of this release. Related Collision or Cargo Incident outcomes are linked as event relationships, not copied here.")}
      <PersonEditor draft={draft} update={update} />
      <MediaEditor draft={draft} update={update} />
      <div className={sectionClass} data-testid="spill-risk-facts">
        <Header title="Risk and exposure facts" hint="A risk is not a confirmed impact. Leave blank when not recorded." />
        {fieldGrid(SPILL_RISK_FACT_KEYS, renderField, "grid gap-3 sm:grid-cols-3")}
      </div>
      <div className={sectionClass} data-testid="spill-other-impact">
        <Header title="Other impact" hint="Compact facts only." />
        {fieldGrid([...SPILL_IMPACT_FACT_KEYS, "otherImpactNote"], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}
      </div>
    </section>
  );
  if (stepKey === "SPILL_RESPONSE") return (
    <section className="space-y-4">{title("Emergency Response", "What was done straight away. These are facts, not Company Actions; leave blank when not recorded.")}
      <div className={sectionClass} data-testid="spill-response-facts">{fieldGrid([...SPILL_RESPONSE_FACT_KEYS], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}</div>
      <TimelineEditor draft={draft} update={update} />
    </section>
  );
  if (stepKey === "SPILL_CLEANUP") return (
    <section className="space-y-4">{title("Cleanup", "Current cleanup status now; detailed cleanup, disposal and verification can be added later.")}
      <div className={sectionClass} data-testid="spill-cleanup-status">{fieldGrid(["cleanupStatus"], renderField, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}</div>
      <CleanupEditor draft={draft} update={update} />
      <FinancialBlock draft={draft} update={update} />
    </section>
  );
  if (stepKey === "SPILL_REGULATORY") return <section className="space-y-4">{title("Regulatory", "Assessment and execution are recorded separately, per obligation. Nothing here is derived from the quantity or the material.")}<ObligationEditor draft={draft} update={update} /></section>;
  return null;
}

/** Evidence stays on the event once; this block only links existing evidence to child records. */
export function SpillEvidencePanel({ draft, update, evidence }: { draft: SpillDraft; update: Update; evidence: SpillEvidenceChoice[] }) {
  const links: Array<{ key: string; label: string; ids: string[]; set: (ids: string[]) => void }> = [
    ...draft.materials.map((item, index) => ({ key: item.itemId, label: `Material: ${materialName(item, index)}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, materials: d.materials.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.quantities.map((item) => ({ key: item.itemId, label: `Quantity: ${spillOptionLabel(SPILL_QUANTITY_DIMENSIONS, item.dimension) || "Unspecified"}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, quantities: d.quantities.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.persons.map((item, index) => ({ key: item.itemId, label: `Person ${index + 1}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, persons: d.persons.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.media.map((item) => ({ key: item.itemId, label: `Environment: ${spillOptionLabel(SPILL_ENVIRONMENTAL_MEDIA, item.medium) || "Unspecified"}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, media: d.media.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.steps.map((item) => ({ key: item.itemId, label: `Response ${item.ordinal || "?"}: ${spillOptionLabel(SPILL_RESPONSE_ACTIONS, item.action) || "Unspecified"}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, steps: d.steps.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.cleanups.map((item, index) => ({ key: item.itemId, label: `Cleanup ${index + 1}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, cleanups: d.cleanups.map((x) => (x.itemId === item.itemId ? { ...x, evidenceIds: ids } : x)) })) })),
    ...draft.obligations.map((item, index) => ({ key: item.assessmentId, label: `Regulatory obligation ${index + 1}${item.jurisdiction ? `: ${item.jurisdiction}` : ""}`, ids: item.evidenceIds, set: (ids: string[]) => update((d) => ({ ...d, obligations: d.obligations.map((x) => (x.assessmentId === item.assessmentId ? { ...x, evidenceIds: ids } : x)) })) })),
  ];
  return (
    <div className={sectionClass} data-testid="spill-evidence-panel">
      <Header title="Evidence references" hint="Evidence is stored once for the Spill / Release. Tick the evidence that supports each record; nothing is copied." />
      {evidence.length === 0 ? <Empty text="Add evidence above first, then link it to records here." /> : links.length === 0 ? <Empty text="No records to link yet." /> : (
        <div className="space-y-2">{links.map((link) => (
          <div key={link.key} className="rounded-lg border border-border bg-background p-2"><div className="text-[11px] font-bold">{link.label}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">{evidence.map((item) => <label key={item.id} className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] ${link.ids.includes(item.id) ? "border-primary bg-primary/5" : "border-border"}`}><input type="checkbox" className="size-3 accent-primary" checked={link.ids.includes(item.id)} onChange={() => link.set(toggle(link.ids, item.id))} />{item.label}</label>)}</div></div>
        ))}</div>
      )}
    </div>
  );
}

export function SpillReviewBlock({ draft, vehicles, facts }: { draft: SpillDraft; vehicles: { powerUnits: Array<{ id: string; unitNumber: string }>; trailers: Array<{ id: string; unitNumber: string }> }; facts: Record<string, unknown> }) {
  const unit = (id: string) => `Unit ${[...vehicles.powerUnits, ...vehicles.trailers].find((vehicle) => vehicle.id === id)?.unitNumber || id}`;
  const label = (list: readonly SpillOption[], value: unknown) => spillOptionLabel(list, typeof value === "string" ? value : undefined);
  const row = (name: string, value: string) => <div className="flex justify-between gap-4 text-xs"><span className="text-muted-foreground">{name}</span><span className="text-right font-semibold">{value || "None"}</span></div>;
  return (
    <div className="space-y-2 rounded-xl border border-border p-4" data-testid="spill-review">
      <div className="mb-1 text-xs font-bold">Spill / Release Records</div>
      {row("Occurrence precision", label(SPILL_OCCURRENCE_PRECISIONS, draft.precision))}
      {row("Power Unit", draft.powerUnitId ? unit(draft.powerUnitId) : "")}
      {row("Trailer(s)", draft.trailerIds.map(unit).join(", "))}
      {row("Materials", draft.materials.map((material, index) => `${materialName(material, index)} (${label(SPILL_IDENTIFICATION_STATUSES, material.identificationStatus) || "status needed"})`).join("; "))}
      {row("Quantities", String(draft.quantities.length))}
      {row("People", String(draft.persons.length))}
      {row("Environmental media", draft.media.map((entry) => `${label(SPILL_ENVIRONMENTAL_MEDIA, entry.medium)}: ${label(SPILL_IMPACT_STATUSES, entry.impactStatus)}`).join("; "))}
      {row("Response steps", String(draft.steps.length))}
      {row("Cleanup records", String(draft.cleanups.length))}
      {row("Regulatory obligations", draft.obligations.map((entry) => `${entry.jurisdiction || entry.authority || "Unnamed"}: ${label(SPILL_ASSESSMENT_STATUSES, entry.assessmentStatus)}`).join("; "))}
      {row("Release determination", label([{ value: "SUSPECTED", label: "Suspected" }, { value: "CONFIRMED", label: "Confirmed" }, { value: "UNKNOWN", label: "Unknown" }], facts.releaseDetermination))}
    </div>
  );
}
