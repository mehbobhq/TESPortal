"use client"

import { Label } from "@/components/ui/label"
import { evaluateScope, involvesCanada, involvesUS, SCOPE_LABEL, validateScopeInput, type BaseScopeKind, type ScopeInput, type ScopeKind } from "@/lib/driver-prospects/operating-scope"
import { jurisdictionGroups, orderScopeKinds, presentationLabel, type PresentationCountry } from "@/lib/jurisdiction-context"

export type ScopeFormState = {
  kind: ScopeKind
  components: BaseScopeKind[]
  us: string[]
  ca: string[]
  cmvOperation: "YES" | "NO" | "UNKNOWN"
  cdlRequired: "YES" | "NO" | "UNKNOWN"
  pspIntended: boolean
  hazmat: boolean
  passengerCarrying: boolean
}

export const emptyScopeForm = (): ScopeFormState => ({ kind: "UNDETERMINED", components: [], us: [], ca: [], cmvOperation: "UNKNOWN", cdlRequired: "UNKNOWN", pspIntended: false, hazmat: false, passengerCarrying: false })

export const toScopeInput = (f: ScopeFormState): ScopeInput => ({
  kind: f.kind,
  components: f.kind === "MIXED" ? f.components : [],
  usJurisdictions: f.us,
  caJurisdictions: f.ca,
  characteristics: { cmvOperation: f.cmvOperation, cdlRequired: f.cdlRequired, pspIntended: f.pspIntended, hazmat: f.hazmat, passengerCarrying: f.passengerCarrying },
})

export function scopeFormFrom(scope: { kind: ScopeKind; components: BaseScopeKind[]; usJurisdictions: string[]; caJurisdictions: string[]; characteristics: { cmvOperation: "YES" | "NO" | "UNKNOWN"; cdlRequired: "YES" | "NO" | "UNKNOWN"; pspIntended: boolean; hazmat: boolean; passengerCarrying: boolean } } | null): ScopeFormState {
  if (!scope) return emptyScopeForm()
  return { kind: scope.kind, components: scope.components, us: scope.usJurisdictions, ca: scope.caJurisdictions, ...scope.characteristics }
}

/** The evaluation of a form as entered (client-side preview of exactly what the server will decide). */
export function previewScope(f: ScopeFormState) {
  const v = validateScopeInput(toScopeInput(f))
  if (!v.ok) return { errors: v.errors, evaluation: null }
  return { errors: [] as string[], evaluation: evaluateScope(v.value) }
}

const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm"
const toggle = (list: string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code].sort())

function JurisdictionList({ country, label, selected, single, presentation, onChange, testId }: { country: "United States" | "Canada"; label: string; selected: string[]; single: boolean; presentation: PresentationCountry | null; onChange: (v: string[]) => void; testId: string }) {
  const group = jurisdictionGroups(presentation).find((g) => g.country === country)!
  if (single) {
    return (
      <div className="space-y-1">
        <Label>{label}</Label>
        <select className={sel} value={selected[0] ?? ""} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])} data-testid={testId}>
          <option value="">Select {group.term.toLowerCase()}</option>
          {group.options.map((o) => <option key={o.code} value={o.code}>{o.label} ({o.code})</option>)}
        </select>
      </div>
    )
  }
  return (
    <fieldset className="space-y-1" data-testid={testId}>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid max-h-40 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded-md border p-2 text-sm sm:grid-cols-3">
        {group.options.map((o) => (
          <label key={o.code} className="flex items-center gap-1.5">
            <input type="checkbox" checked={selected.includes(o.code)} onChange={() => onChange(toggle(selected, o.code))} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

const COMPONENT_OPTIONS: BaseScopeKind[] = ["US_INTRASTATE", "US_INTERSTATE", "CA_INTRAPROVINCIAL", "CA_INTERPROVINCIAL", "CROSS_BORDER"]

/**
 * The driver's intended operating scope. Independent of the company: the company's presentation country only decides what is listed first.
 * Nothing is assumed: the default is "Not yet determined", and no cross-border option is pre-selected.
 */
export function OperatingScopeFields({ value, onChange, presentation, idPrefix = "scope" }: { value: ScopeFormState; onChange: (v: ScopeFormState) => void; presentation: PresentationCountry | null; idPrefix?: string }) {
  const set = (patch: Partial<ScopeFormState>) => onChange({ ...value, ...patch })
  const order = orderScopeKinds(presentation)
  const pseudo = { kind: value.kind, components: value.components, usJurisdictions: value.us, caJurisdictions: value.ca }
  const kindUS = value.kind === "MIXED" ? value.components.some((c) => c !== "CA_INTRAPROVINCIAL" && c !== "CA_INTERPROVINCIAL") : involvesUS(pseudo) || ["US_INTRASTATE", "US_INTERSTATE", "CROSS_BORDER"].includes(value.kind)
  const kindCA = value.kind === "MIXED" ? value.components.some((c) => c !== "US_INTRASTATE" && c !== "US_INTERSTATE") : involvesCanada(pseudo) || ["CA_INTRAPROVINCIAL", "CA_INTERPROVINCIAL", "CROSS_BORDER"].includes(value.kind)
  const singleUS = value.kind === "US_INTRASTATE"
  const singleCA = value.kind === "CA_INTRAPROVINCIAL"
  const preview = previewScope(value)
  const groups = jurisdictionGroups(presentation)
  const ordered = (country: "United States" | "Canada") => groups.findIndex((g) => g.country === country)
  const pickers = [
    kindUS && { order: ordered("United States"), node: <JurisdictionList key="us" country="United States" label={`U.S. ${singleUS ? "state" : "states"} the driver will operate in`} selected={value.us} single={singleUS} presentation={presentation} onChange={(us) => set({ us })} testId={`${idPrefix}-us`} /> },
    kindCA && { order: ordered("Canada"), node: <JurisdictionList key="ca" country="Canada" label={`Canadian ${singleCA ? "province or territory" : "provinces and territories"} the driver will operate in`} selected={value.ca} single={singleCA} presentation={presentation} onChange={(ca) => set({ ca })} testId={`${idPrefix}-ca`} /> },
  ].filter(Boolean) as Array<{ order: number; node: React.ReactNode }>
  pickers.sort((a, b) => a.order - b.order)
  return (
    <div className="space-y-4" data-testid={`${idPrefix}-fields`}>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-kind`}>Intended operation{presentation ? ` (${presentationLabel(presentation)} company — domestic options first)` : ""}</Label>
        <select id={`${idPrefix}-kind`} className={sel} value={value.kind} onChange={(e) => set({ kind: e.target.value as ScopeKind, us: [], ca: [], components: [] })} data-testid={`${idPrefix}-kind`}>
          {order.map((k) => <option key={k} value={k}>{SCOPE_LABEL[k]}</option>)}
        </select>
        <p className="text-[11px] text-muted-foreground">Based on what this driver will actually do, not on where the company is registered. It decides which application sections are sent.</p>
      </div>

      {value.kind === "MIXED" ? (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Assignments that may apply</legend>
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            {orderScopeKinds(presentation).filter((k): k is BaseScopeKind => COMPONENT_OPTIONS.includes(k as BaseScopeKind)).map((k) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" checked={value.components.includes(k)} onChange={() => set({ components: value.components.includes(k) ? value.components.filter((c) => c !== k) : [...value.components, k] })} />
                <span>{SCOPE_LABEL[k]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {value.kind !== "UNDETERMINED" ? pickers.map((p) => p.node) : null}

      {value.kind !== "UNDETERMINED" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {kindUS ? (
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-cmv`}>Will the driver operate a commercial motor vehicle in the U.S.?</Label>
              <select id={`${idPrefix}-cmv`} className={sel} value={value.cmvOperation} onChange={(e) => set({ cmvOperation: e.target.value as ScopeFormState["cmvOperation"] })} data-testid={`${idPrefix}-cmv`}>
                <option value="UNKNOWN">Not sure yet</option><option value="YES">Yes</option><option value="NO">No</option>
              </select>
            </div>
          ) : null}
          {kindUS && value.cmvOperation === "YES" ? (
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-cdl`}>Is a commercial driver&apos;s licence required?</Label>
              <select id={`${idPrefix}-cdl`} className={sel} value={value.cdlRequired} onChange={(e) => set({ cdlRequired: e.target.value as ScopeFormState["cdlRequired"] })} data-testid={`${idPrefix}-cdl`}>
                <option value="UNKNOWN">Not sure yet</option><option value="YES">Yes</option><option value="NO">No</option>
              </select>
            </div>
          ) : null}
          <div className="space-y-1 sm:col-span-2">
            {kindUS && value.cmvOperation === "YES" ? (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.pspIntended} onChange={(e) => set({ pspIntended: e.target.checked })} data-testid={`${idPrefix}-psp`} />The carrier intends to request an FMCSA PSP report for this driver</label>
            ) : null}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.hazmat} onChange={(e) => set({ hazmat: e.target.checked })} />Hazardous-materials work</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.passengerCarrying} onChange={(e) => set({ passengerCarrying: e.target.checked })} />Passenger-carrying work</label>
          </div>
        </div>
      ) : null}

      <div className="rounded-md border bg-muted/30 p-3 text-xs" data-testid={`${idPrefix}-preview`} role="status">
        {preview.errors.length ? (
          <p className="text-red-700">{preview.errors.join(" ")}</p>
        ) : preview.evaluation && preview.evaluation.issuable ? (
          <div className="space-y-1">
            <p className="font-semibold">Application will include</p>
            <p>{preview.evaluation.profile.applicationRegion} application · {preview.evaluation.profile.employmentHistoryYears}-year employment history{preview.evaluation.profile.sections.clearinghouse ? " · FMCSA Clearinghouse consent" : ""}{preview.evaluation.profile.sections.psp ? " · FMCSA PSP authorization" : ""}{preview.evaluation.profile.sections.dotDrugAlcoholHistory ? " · DOT drug and alcohol history" : ""}</p>
            {preview.evaluation.profile.manualVerification.length ? <p className="text-muted-foreground">To verify outside the application: {preview.evaluation.profile.manualVerification.join(" ")}</p> : null}
          </div>
        ) : (
          <p>{preview.evaluation?.reason}</p>
        )}
        <p className="mt-1 text-muted-foreground">Selecting a scope does not establish that the driver is qualified or eligible.</p>
      </div>
    </div>
  )
}
