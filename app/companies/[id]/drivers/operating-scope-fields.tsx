"use client"

import { Label } from "@/components/ui/label"
import { evaluateScope, validateScopeInput, type ScopeInput, type ScopeKind } from "@/lib/driver-prospects/operating-scope"
import {
  applyCompanyFacts,
  DEFAULT_INTENDED_OPERATION,
  INTENDED_OPERATION_LABEL,
  orderIntendedOperations,
  type CompanyOperatingFacts,
  type IntendedOperation,
} from "@/lib/driver-prospects/company-operating-facts"

/**
 * The driver's intended operation. One question only: the selected operation decides the regulatory scope, and everything the company already
 * recorded (registration country, Cargo Information, rule applicability) is READ from the company's canonical Profile, never asked again.
 */
export type ScopeFormState = { kind: ScopeKind }

export const emptyScopeForm = (): ScopeFormState => ({ kind: DEFAULT_INTENDED_OPERATION })

/** Only the intended operation is sent. Everything else already stored for the driver is kept by the server (mergeScopeInput). */
export const toScopeInput = (f: ScopeFormState): ScopeInput => ({ kind: f.kind })

export const scopeFormFrom = (scope: { kind: ScopeKind } | null): ScopeFormState => (scope ? { kind: scope.kind } : emptyScopeForm())

export const operationLabel = (kind: ScopeKind): string => (INTENDED_OPERATION_LABEL as Record<string, string>)[kind] ?? "Mixed assignments (earlier record)"

/** The evaluation of a form as entered, with the company's facts applied: exactly what the server decides at issuance. */
export function previewScope(f: ScopeFormState, facts: CompanyOperatingFacts | null) {
  const v = validateScopeInput(toScopeInput(f))
  if (!v.ok) return { errors: v.errors, evaluation: null, needsAttention: [] as Array<{ id: string; text: string }> }
  if (!facts) return { errors: [] as string[], evaluation: evaluateScope(v.value), needsAttention: [] as Array<{ id: string; text: string }> }
  const effective = applyCompanyFacts(v.value, facts)
  return { errors: [] as string[], evaluation: evaluateScope(effective.scope), needsAttention: effective.needsAttention, scope: effective.scope }
}

const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm"

export function OperatingScopeFields({ value, onChange, facts, idPrefix = "scope" }: { value: ScopeFormState; onChange: (v: ScopeFormState) => void; facts: CompanyOperatingFacts | null; idPrefix?: string }) {
  const country = facts?.registration.country ?? null
  const options: ScopeKind[] = orderIntendedOperations(country)
  if (!options.includes(value.kind)) options.push(value.kind) // an earlier record's kind stays visible
  const preview = previewScope(value, facts)
  const ch = preview.scope?.characteristics
  return (
    <div className="space-y-3" data-testid={`${idPrefix}-fields`}>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-kind`}>Intended operation</Label>
        <select id={`${idPrefix}-kind`} className={sel} value={value.kind} onChange={(e) => onChange({ kind: e.target.value as ScopeKind })} data-testid={`${idPrefix}-kind`}>
          {options.map((k) => <option key={k} value={k}>{operationLabel(k)}</option>)}
        </select>
        <p className="text-[11px] text-muted-foreground">Based on what this driver will actually do. All options are available to every company; the company&apos;s registration only decides the order.</p>
      </div>

      {facts && facts.registration.country === null ? (
        <p role="note" className="rounded border border-yellow-400 bg-yellow-50 px-2 py-1 text-xs text-yellow-900" data-testid={`${idPrefix}-config-notice`}>
          Configuration needed: {facts.registration.reason ?? "the company's registration country is not recorded."} Complete the company Profile so the options can be ordered for this company. The driver can still be saved.
        </p>
      ) : null}

      <div className="rounded-md border bg-muted/30 p-3 text-xs" data-testid={`${idPrefix}-preview`} role="status">
        {preview.errors.length ? (
          <p className="text-red-700">{preview.errors.join(" ")}</p>
        ) : preview.evaluation && preview.evaluation.issuable ? (
          <div className="space-y-1">
            <p className="font-semibold">Application will include</p>
            <p>{preview.evaluation.profile.applicationRegion} application · {preview.evaluation.profile.employmentHistoryYears}-year employment history{preview.evaluation.profile.sections.clearinghouse ? " · FMCSA Clearinghouse consent" : ""}{preview.evaluation.profile.sections.psp ? " · FMCSA PSP authorization" : ""}{preview.evaluation.profile.sections.dotDrugAlcoholHistory ? " · DOT drug and alcohol history" : ""}{ch?.hazmat ? " · Hazardous-materials questions" : ""}{ch?.passengerCarrying ? " · Passenger-carrying questions" : ""}</p>
            {preview.evaluation.profile.manualVerification.length ? <p className="text-muted-foreground">To verify outside the application: {preview.evaluation.profile.manualVerification.join(" ")}</p> : null}
            {preview.needsAttention.length ? (
              <ul className="list-disc space-y-0.5 pl-4 text-yellow-900" data-testid={`${idPrefix}-needs-attention`}>
                {preview.needsAttention.map((n) => <li key={n.id}>{n.text}</li>)}
              </ul>
            ) : null}
          </div>
        ) : (
          <p>{preview.evaluation?.reason}</p>
        )}
        <p className="mt-1 text-muted-foreground">Company information decides which questions are sent. It does not make any driver qualified, endorsed, medically certified or authorized.</p>
      </div>
    </div>
  )
}
export type { IntendedOperation }
