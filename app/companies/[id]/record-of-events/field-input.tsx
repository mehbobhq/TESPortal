"use client"

import { TESDateField, TESTimeField } from "@/components/ui/tes-date-field"
import type { PerformanceFieldDefinition } from "@/lib/driver-performance-schema"
import type { FactState, Scalar } from "@/lib/driver-events/validation"

export const inputClass = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"

const STATE_LABEL: Record<FactState, string> = { PROVIDED: "Provide a value", UNKNOWN: "Unknown", NOT_APPLICABLE: "Not applicable", NOT_COLLECTED: "Not collected" }

export function Label({ children, required, htmlFor }: { children: React.ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-semibold text-foreground">
      {children}
      {required ? <span className="text-destructive"> *</span> : null}
    </label>
  )
}

/**
 * One registry field, rendered by what it is. A value, or one of three STATED absences (unknown / not applicable / not collected) - a blank is never read as
 * zero or as "no". Units are explicit where the field offers several.
 */
export function FieldInput({
  field, value, unit, state, error, onChange, onUnit, onState, required,
}: {
  field: PerformanceFieldDefinition
  value: Scalar | undefined
  unit: string | undefined
  state: FactState | undefined
  error?: string
  required: boolean
  onChange: (value: Scalar | undefined) => void
  onUnit: (unit: string | undefined) => void
  onState: (state: FactState | undefined) => void
}) {
  const id = `fact-${field.key}`
  const stated = state && state !== "PROVIDED"
  return (
    <div className="space-y-1" data-field={field.key}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} required={required}>{field.label}</Label>
        <select
          aria-label={`${field.label}: value status`}
          value={stated ? state : "PROVIDED"}
          onChange={(e) => { const next = e.target.value as FactState; if (next !== "PROVIDED") onChange(undefined); onState(next === "PROVIDED" ? undefined : next) }}
          className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {(Object.keys(STATE_LABEL) as FactState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
        </select>
      </div>
      {stated ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">Recorded as: {STATE_LABEL[state!].toLowerCase()}.</p>
      ) : field.kind === "select" ? (
        <select id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className={inputClass}>
          <option value="">Select…</option>
          {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : field.kind === "boolean" ? (
        <select id={id} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "yes")} className={inputClass}>
          <option value="">Select…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      ) : field.kind === "number" ? (
        <div className="flex gap-2">
          <input id={id} type="number" inputMode="decimal" step="any" value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className={inputClass} />
          {field.unitOptions?.length ? (
            <select aria-label={`${field.label} unit`} value={unit ?? ""} onChange={(e) => onUnit(e.target.value || undefined)} className={`${inputClass} w-28`}>
              <option value="">Unit…</option>
              {field.unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          ) : field.unit ? <span className="mt-1 self-center text-[11px] text-muted-foreground">{field.unit}</span> : null}
        </div>
      ) : field.kind === "date" ? (
        <TESDateField id={id} value={(value as string) ?? ""} onValueChange={(v) => onChange(v || undefined)} max={undefined} />
      ) : field.kind === "time" ? (
        <TESTimeField id={id} value={(value as string) ?? ""} onValueChange={(v: string) => onChange(v || undefined)} />
      ) : field.kind === "textarea" ? (
        <textarea id={id} rows={3} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className={inputClass} />
      ) : (
        <input id={id} type="text" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className={inputClass} />
      )}
      {field.helpText ? <p className="text-[10px] leading-4 text-muted-foreground">{field.helpText}</p> : null}
      {error ? <p role="alert" className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  )
}
