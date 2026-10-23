import type { ItemField, Option, OptionsRef, Validation } from "./catalogue/types"
import { evalCond } from "./conditions"
import type { ApplicationPlan, PlanField } from "./plan"
import { JURISDICTIONS } from "@/lib/jurisdictions"

const US_CODES = JURISDICTIONS.filter((j) => j.country === "United States").map((j) => j.code)
const CA_CODES = JURISDICTIONS.filter((j) => j.country === "Canada").map((j) => j.code)

export const optionValues = (options: Option[] | undefined, ref: OptionsRef | undefined): string[] | null =>
  ref === "jurisdictions.us" ? US_CODES : ref === "jurisdictions.ca" ? CA_CODES : ref === "jurisdictions.all" ? [...US_CODES, ...CA_CODES] : options ? options.map((o) => o.value) : null

export type Answers = Record<string, unknown>
export type ItemErrors = Array<Record<string, string>>

export interface ValidationExtras {
  /** Current (non-superseded) uploads with their evidence lifecycle state. */
  uploads: Array<{ fieldId: string; slot: string; state: string }>
  /** Sensitive field ids that are in the vault. */
  sensitiveCollected: string[]
  /** Authorizations the applicant has accepted. */
  consents: Array<{ key: string; version: string; textSha256: string }>
  today?: Date
}

export interface ValidationResult {
  ok: boolean
  errors: Record<string, string>
  itemErrors: Record<string, ItemErrors>
  applicable: Record<string, boolean>
  missingConsents: string[]
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86_400_000

export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d
}
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

export const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0)

/** Value-level checks shared by fields and repeatable items. Returns a message or null. */
function checkValue(type: string, value: unknown, v: Validation | undefined, options: string[] | null, today: Date): string | null {
  if (isBlank(value)) return null
  switch (type) {
    case "text": case "textarea": case "email": case "phone": {
      if (typeof value !== "string") return "Enter text."
      const t = value.trim()
      if (v?.minLength && t.length < v.minLength) return `Enter at least ${v.minLength} characters.`
      if (v?.maxLength && t.length > v.maxLength) return `Use at most ${v.maxLength} characters.`
      if (v?.pattern && !new RegExp(v.pattern).test(t)) return v.patternMessage ?? "This value is not in the expected format."
      return null
    }
    case "date": {
      const d = parseDate(value)
      if (!d) return "Enter a valid date."
      if (v?.notFuture && d.getTime() > today.getTime()) return "The date cannot be in the future."
      if (v?.notPast && d.getTime() < today.getTime()) return "This date has already passed."
      if (v?.minAgeYears) {
        const limit = new Date(Date.UTC(today.getUTCFullYear() - v.minAgeYears, today.getUTCMonth(), today.getUTCDate()))
        if (d.getTime() > limit.getTime()) return `You must be at least ${v.minAgeYears} years old.`
      }
      return null
    }
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN
      if (!Number.isFinite(n)) return "Enter a number."
      if (v?.min !== undefined && n < v.min) return `Enter ${v.min} or more.`
      if (v?.max !== undefined && n > v.max) return `Enter ${v.max} or less.`
      return null
    }
    case "yesno": return value === "yes" || value === "no" ? null : "Choose yes or no."
    case "select": return typeof value === "string" && (!options || options.includes(value)) ? null : "Choose one of the options."
    case "multiselect": {
      if (!Array.isArray(value) || value.some((x) => typeof x !== "string" || (options && !options.includes(x)))) return "Choose from the options."
      if (v?.minItems && value.length < v.minItems) return `Choose at least ${v.minItems}.`
      return null
    }
    default: return null
  }
}

export interface Coverage {
  ok: boolean
  /** Uncovered stretches (in days) longer than the tolerated 30 days within the required window. */
  gaps: Array<{ from: string; to: string; days: number }>
}

/** Do the entries cover the last `years` years up to today, tolerating gaps of 30 days or less? */
export function coverage(entries: Array<{ from?: unknown; to?: unknown }>, years: number, today: Date): Coverage {
  const end = startOfDay(today).getTime()
  const startDate = startOfDay(today)
  startDate.setUTCFullYear(startDate.getUTCFullYear() - years)
  const start = startDate.getTime()
  const spans = entries
    .map((e) => {
      const from = parseDate(e.from)
      const to = isBlank(e.to) ? new Date(end) : parseDate(e.to)
      return from && to ? ([from.getTime(), to.getTime()] as const) : null
    })
    .filter((s): s is readonly [number, number] => s !== null && s[1] >= s[0])
    .sort((a, b) => a[0] - b[0])
  const gaps: Coverage["gaps"] = []
  let cursor = start
  for (const [from, to] of spans) {
    if (to < cursor) continue
    if (from > cursor) {
      const days = Math.round((from - cursor) / DAY)
      if (days > 30) gaps.push({ from: new Date(cursor).toISOString().slice(0, 10), to: new Date(from).toISOString().slice(0, 10), days })
    }
    cursor = Math.max(cursor, to)
  }
  if (end > cursor) {
    const days = Math.round((end - cursor) / DAY)
    if (days > 30) gaps.push({ from: new Date(cursor).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10), days })
  }
  return { ok: gaps.length === 0, gaps }
}

export type Mode = "draft" | "submit"

/** Which plan fields apply to THESE answers (never to unknown ones). Inapplicable answers are retained by the draft but are not current facts. */
export function applicableFields(plan: ApplicationPlan, answers: Answers): { field: PlanField; required: boolean }[] {
  const scope = { ctx: plan.context as unknown as Record<string, unknown>, ans: answers }
  const out: { field: PlanField; required: boolean }[] = []
  for (const field of plan.fields) {
    if (evalCond(field.appliesWhen, scope) !== "T") continue
    const required = typeof field.required === "boolean" ? field.required : evalCond(field.required, scope) === "T"
    out.push({ field, required })
  }
  return out
}

export function validateAnswers(plan: ApplicationPlan, answers: Answers, mode: Mode, extras: ValidationExtras): ValidationResult {
  const today = startOfDay(extras.today ?? new Date())
  const errors: Record<string, string> = {}
  const itemErrors: Record<string, ItemErrors> = {}
  const applicable: Record<string, boolean> = {}
  const submit = mode === "submit"

  const applicableSet = new Map(applicableFields(plan, answers).map((a) => [a.field.id, a]))
  for (const field of plan.fields) applicable[field.id] = applicableSet.has(field.id)

  for (const { field, required } of applicableSet.values()) {
    const value = answers[field.id]
    if (field.type === "upload") {
      const have = extras.uploads.some((u) => u.fieldId === field.id && u.state !== "blocked")
      if (submit && required && !have) errors[field.id] = "Upload this document."
      continue
    }
    if (field.type === "sensitive") {
      if (!field.collection.enabled) continue
      if (submit && required && !extras.sensitiveCollected.includes(field.id)) errors[field.id] = "This information is required."
      continue
    }
    if (field.type === "repeatable") {
      const list = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
      if (value !== undefined && value !== null && !Array.isArray(value)) {
        errors[field.id] = "Provide a list of entries."
        continue
      }
      if (submit && required && list.length === 0) {
        errors[field.id] = "Add at least one entry."
        continue
      }
      if (field.validation?.maxItems && list.length > field.validation.maxItems) errors[field.id] = `Add at most ${field.validation.maxItems} entries.`
      else if (submit && list.length > 0 && field.validation?.minItems && list.length < field.validation.minItems) errors[field.id] = `Add at least ${field.validation.minItems} entries.`
      const perItem: ItemErrors = []
      let any = false
      list.forEach((entry, index) => {
        const e: Record<string, string> = {}
        for (const sub of field.itemFields ?? []) {
          if (evalCond(sub.appliesWhen, { ctx: plan.context as unknown as Record<string, unknown>, ans: answers, item: entry }) !== "T") continue
          const msg = validateItemField(sub, entry[sub.id], submit, today)
          if (msg) e[sub.id] = msg
        }
        if (Object.keys(e).length) any = true
        perItem[index] = e
      })
      if (any) itemErrors[field.id] = perItem
      if (submit && field.validation?.coverageYears && list.length > 0 && !errors[field.id]) {
        const years = field.validation.coverageYears === "ctx.historyYears" ? plan.context.historyYears : field.validation.coverageYears
        const cov = coverage(list, years, today)
        if (!cov.ok) {
          const gapText = cov.gaps.map((g) => `${g.from} to ${g.to}`).join("; ")
          if (field.id === "employment.history") {
            if (isBlank(answers["employment.gap_explanation"])) errors["employment.gap_explanation"] = `Explain the periods not covered (${gapText}).`
            errors[field.id] = errors[field.id] ?? `The last ${years} years must be covered. Not covered: ${gapText}.`
          } else errors[field.id] = `Cover the last ${years} years. Not covered: ${gapText}.`
        }
      }
      continue
    }
    if (isBlank(value)) {
      if (submit && required) errors[field.id] = "This information is required."
      continue
    }
    const msg = checkValue(field.type, value, field.validation, optionValues(field.options, field.optionsRef), today)
    if (msg) errors[field.id] = msg
  }

  const missingConsents: string[] = []
  if (submit) {
    for (const c of plan.consents) {
      if (c.external) continue
      if (!extras.consents.some((x) => x.key === c.key && x.version === c.version && x.textSha256 === c.textSha256)) missingConsents.push(c.key)
    }
  }
  const ok = Object.keys(errors).length === 0 && Object.keys(itemErrors).length === 0 && missingConsents.length === 0
  return { ok, errors, itemErrors, applicable, missingConsents }
}

function validateItemField(sub: ItemField, value: unknown, submit: boolean, today: Date): string | null {
  if (isBlank(value)) return submit && sub.required ? "Required." : null
  return checkValue(sub.type, value, sub.validation, optionValues(sub.options, sub.optionsRef), today)
}

/** Normalizes a name for the signature comparison: case, accents of spacing and punctuation do not matter; the letters do. */
export const normalizeName = (name: string) => name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ")
