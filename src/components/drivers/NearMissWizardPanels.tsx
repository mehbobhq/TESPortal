"use client";

import React, { useMemo } from "react";
import { loadVehicleStore } from "@/lib/vehicle-data";
import {
  NEAR_MISS_IMMEDIATE_RESPONSES,
  NEAR_MISS_POTENTIAL_CONSEQUENCES,
  NEAR_MISS_TYPE_GROUPS,
  type NearMissOption,
} from "@/lib/performance-near-miss-taxonomy";

const inputClass = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";

export interface NearMissWizardSelection {
  secondary: string[];
  consequences: string[];
  responses: string[];
  powerUnitId: string;
  trailerIds: string[];
}

export const EMPTY_NEAR_MISS_SELECTION: NearMissWizardSelection = { secondary: [], consequences: [], responses: [], powerUnitId: "", trailerIds: [] };

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

function CheckGrid({ legend, helpText, options, selected, onToggle, disabledValues = [] }: { legend: string; helpText?: string; options: readonly NearMissOption[]; selected: string[]; onToggle: (value: string) => void; disabledValues?: string[] }) {
  return (
    <fieldset className="rounded-xl border border-border bg-muted/10 p-3">
      <legend className="px-1 text-xs font-bold text-foreground">{legend}</legend>
      {helpText ? <p className="mb-2 text-[10px] text-muted-foreground">{helpText}</p> : null}
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => {
          const disabled = disabledValues.includes(option.value);
          return (
            <label key={option.value} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${selected.includes(option.value) ? "border-primary bg-primary/5" : "border-border bg-background"} ${disabled ? "opacity-50" : ""}`}>
              <input type="checkbox" className="mt-0.5 size-3.5 accent-primary" checked={selected.includes(option.value)} disabled={disabled} onChange={() => onToggle(option.value)} />
              <span className="min-w-0 break-words">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Controlled multi-value capture for Near Miss (Secondary types, Potential Consequences, Immediate Response). */
export function NearMissFactsPanel({ primaryType, selection, onChange, consequenceOther, onConsequenceOther, responseOther, onResponseOther }: {
  primaryType: string;
  selection: NearMissWizardSelection;
  onChange: (next: NearMissWizardSelection) => void;
  consequenceOther: string;
  onConsequenceOther: (value: string) => void;
  responseOther: string;
  onResponseOther: (value: string) => void;
}) {
  return (
    <div className="space-y-4" data-testid="near-miss-multi-values">
      <fieldset className="rounded-xl border border-border bg-muted/10 p-3">
        <legend className="px-1 text-xs font-bold text-foreground">Secondary Near-Miss Type(s) <span className="font-normal text-muted-foreground">(optional)</span></legend>
        <p className="mb-2 text-[10px] text-muted-foreground">Same taxonomy as the Primary type. Contributing factors such as congestion are recorded later by the investigation, not here.</p>
        <div className="space-y-2">
          {NEAR_MISS_TYPE_GROUPS.map((group) => (
            <div key={group.key}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{group.label}</div>
              <div className="mt-1 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {group.types.map((option) => {
                  const isPrimary = option.value === primaryType;
                  const checked = selection.secondary.includes(option.value);
                  return (
                    <label key={option.value} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${checked ? "border-primary bg-primary/5" : "border-border bg-background"} ${isPrimary ? "opacity-50" : ""}`}>
                      <input type="checkbox" className="mt-0.5 size-3.5 accent-primary" checked={checked} disabled={isPrimary} onChange={() => onChange({ ...selection, secondary: toggle(selection.secondary, option.value) })} />
                      <span className="min-w-0 break-words">{option.label}{isPrimary ? " (primary)" : ""}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <CheckGrid legend="Potential Consequences" helpText="What reasonably could have occurred - not actual outcomes." options={NEAR_MISS_POTENTIAL_CONSEQUENCES} selected={selection.consequences} onToggle={(value) => onChange({ ...selection, consequences: toggle(selection.consequences, value) })} />
      {selection.consequences.includes("OTHER") ? <div><label className="text-xs font-semibold">Other Potential Consequence <span className="text-destructive">*</span></label><input value={consequenceOther} onChange={(e) => onConsequenceOther(e.target.value)} className={inputClass} /></div> : null}

      <CheckGrid legend="Immediate Response" helpText="Actions taken at the time - not later corrective actions." options={NEAR_MISS_IMMEDIATE_RESPONSES} selected={selection.responses} onToggle={(value) => onChange({ ...selection, responses: toggle(selection.responses, value) })} />
      {selection.responses.includes("OTHER") ? <div><label className="text-xs font-semibold">Other Immediate Response <span className="text-destructive">*</span></label><input value={responseOther} onChange={(e) => onResponseOther(e.target.value)} className={inputClass} /></div> : null}
    </div>
  );
}

export interface NearMissVehicleChoice { id: string; unitNumber: string; equipmentType: string }

type NearMissVehicleLists = { powerUnits: NearMissVehicleChoice[]; trailers: NearMissVehicleChoice[] };

/** Review-step summary of the Near Miss selections (labels only). */
export function NearMissReviewBlock({ selection, vehicles, primaryLabel }: { selection: NearMissWizardSelection; vehicles: NearMissVehicleLists; primaryLabel: string }) {
  const label = (list: readonly NearMissOption[], value: string) => list.find((item) => item.value === value)?.label || value;
  const secondaryLabel = (value: string) => NEAR_MISS_TYPE_GROUPS.flatMap((group) => group.types).find((item) => item.value === value)?.label || value;
  const unit = (id: string) => [...vehicles.powerUnits, ...vehicles.trailers].find((vehicle) => vehicle.id === id);
  const row = (name: string, value: string) => <div className="flex justify-between gap-4 text-xs"><span className="text-muted-foreground">{name}</span><span className="text-right font-semibold">{value || "None"}</span></div>;
  return (
    <div className="space-y-2 rounded-xl border border-border p-4" data-testid="near-miss-review">
      <div className="mb-1 text-xs font-bold">Near Miss Selections</div>
      {row("Primary Near-Miss Type", primaryLabel)}
      {row("Secondary Near-Miss Type(s)", selection.secondary.map(secondaryLabel).join(", "))}
      {row("Potential Consequences", selection.consequences.map((value) => label(NEAR_MISS_POTENTIAL_CONSEQUENCES, value)).join(", "))}
      {row("Immediate Response", selection.responses.map((value) => label(NEAR_MISS_IMMEDIATE_RESPONSES, value)).join(", "))}
      {row("Power Unit", selection.powerUnitId ? `Unit ${unit(selection.powerUnitId)?.unitNumber || selection.powerUnitId}` : "")}
      {row("Trailer(s)", selection.trailerIds.map((id) => `Unit ${unit(id)?.unitNumber || id}`).join(", "))}
    </div>
  );
}

const isTrailer = (equipmentType: string) => /^trailer/i.test(equipmentType.trim());

export function useNearMissVehicles(companyId: string): { powerUnits: NearMissVehicleChoice[]; trailers: NearMissVehicleChoice[] } {
  return useMemo(() => {
    const vehicles = loadVehicleStore(companyId).vehicles.map((vehicle) => ({ id: vehicle.id, unitNumber: String((vehicle as { unitNumber?: string }).unitNumber || vehicle.id), equipmentType: String((vehicle as { equipmentType?: string }).equipmentType || "") }));
    return { powerUnits: vehicles.filter((vehicle) => !isTrailer(vehicle.equipmentType)), trailers: vehicles.filter((vehicle) => isTrailer(vehicle.equipmentType)) };
  }, [companyId]);
}

/** Canonical relationships only: Power Unit (required) and Trailer(s) come from the company Vehicle store; nothing is invented. */
export function NearMissRelationshipsPanel({ vehicles, selection, onChange }: { vehicles: { powerUnits: NearMissVehicleChoice[]; trailers: NearMissVehicleChoice[] }; selection: NearMissWizardSelection; onChange: (next: NearMissWizardSelection) => void }) {
  return (
    <div className="space-y-4" data-testid="near-miss-relationships">
      <div className="rounded-xl border border-border bg-muted/10 p-3">
        <label htmlFor="near-miss-power-unit" className="text-xs font-bold text-foreground">Power Unit <span className="text-destructive">*</span></label>
        <select id="near-miss-power-unit" value={selection.powerUnitId} onChange={(e) => onChange({ ...selection, powerUnitId: e.target.value })} className={inputClass}>
          <option value="">Select...</option>
          {vehicles.powerUnits.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>Unit {vehicle.unitNumber}{vehicle.equipmentType ? ` - ${vehicle.equipmentType}` : ""}</option>)}
        </select>
        {vehicles.powerUnits.length === 0 ? <p className="mt-1 text-[10px] text-destructive">This company has no power units on record. Add the vehicle in the Vehicles module first.</p> : null}
      </div>
      <CheckGrid legend="Trailer(s)" helpText="Optional. Only trailers on record for this company are listed." options={vehicles.trailers.map((vehicle) => ({ value: vehicle.id, label: `Unit ${vehicle.unitNumber}${vehicle.equipmentType ? ` - ${vehicle.equipmentType}` : ""}` }))} selected={selection.trailerIds} onToggle={(value) => onChange({ ...selection, trailerIds: toggle(selection.trailerIds, value) })} />
      <p className="text-[10px] leading-4 text-muted-foreground">Co-driver, Trip, Load, Customer and Customer Site relationships are not captured yet: TES has no canonical records to link them to, and no placeholder records are created.</p>
    </div>
  );
}
