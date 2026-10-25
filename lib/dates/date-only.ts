/**
 * TES calendar-date helpers.
 *
 * A "date-only" value is a calendar date written YYYY-MM-DD (a date of birth, a licence expiry, an invoice date). It has no time and NO time zone, so it
 * must never be converted through a Date in the viewer's zone: every function here works on the year/month/day numbers directly (UTC arithmetic is used
 * only to find the weekday or to step days, never to read a local clock). The only function that reads a clock is todayLocalDate / todayInZone.
 */

export const DATE_ONLY_FORMAT = "YYYY-MM-DD" as const
export const DEFAULT_MIN_DATE = "1900-01-01"
export const DEFAULT_MAX_DATE = "2100-12-31"

export interface DateParts {
  year: number
  month: number
  day: number
}

const STRICT = /^(\d{4})-(\d{2})-(\d{2})$/
const TIMESTAMP_PREFIX = /^(\d{4})-(\d{2})-(\d{2})[T ]/

export const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0")

export function formatDateOnly(p: DateParts): string {
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`
}

/** Strict YYYY-MM-DD with a real calendar day, or null. */
export function parseDateOnly(value: unknown): DateParts | null {
  if (typeof value !== "string") return null
  const m = STRICT.exec(value)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

export const isValidDateOnly = (value: unknown) => parseDateOnly(value) !== null

/**
 * Normalises what an API or database may hand back for a date column: "YYYY-MM-DD", or an ISO timestamp whose date part is the calendar date
 * ("2026-10-25T00:00:00.000Z"). The date part is taken AS WRITTEN: the timestamp is not converted to the viewer's zone, so the date cannot shift.
 * Returns "" when the value is empty or not a real date.
 */
export function normalizeDateOnly(value: unknown): string {
  if (typeof value !== "string") return ""
  const raw = value.trim()
  if (!raw) return ""
  const direct = parseDateOnly(raw)
  if (direct) return formatDateOnly(direct)
  const ts = TIMESTAMP_PREFIX.exec(raw)
  if (ts) {
    const p = parseDateOnly(`${ts[1]}-${ts[2]}-${ts[3]}`)
    if (p) return formatDateOnly(p)
  }
  return ""
}

export function compareDateOnly(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0 // fixed-width YYYY-MM-DD sorts lexicographically
}

/** Day of week, 0 = Sunday. */
export function weekdayOf(value: string): number {
  const p = parseDateOnly(value)
  if (!p) throw new RangeError(`Not a date: ${value}`)
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
}

export function addDays(value: string, days: number): string {
  const p = parseDateOnly(value)
  if (!p) throw new RangeError(`Not a date: ${value}`)
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days))
  return formatDateOnly({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() })
}

/** Same day in another month; the day is clamped to the month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(value: string, months: number): string {
  const p = parseDateOnly(value)
  if (!p) throw new RangeError(`Not a date: ${value}`)
  const index = p.year * 12 + (p.month - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12 + 12) % 12 + 1
  return formatDateOnly({ year, month, day: Math.min(p.day, daysInMonth(year, month)) })
}

/** The viewer's calendar date today (device clock and zone). */
export function todayLocalDate(now: Date = new Date()): string {
  return formatDateOnly({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() })
}

/** The calendar date it is right now in a named IANA zone. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return formatDateOnly({ year: get("year"), month: get("month"), day: get("day") })
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const

/** "Sunday, 25 October 2026" — fixed English wording so it does not depend on the browser locale. */
export function describeDate(value: string): string {
  const p = parseDateOnly(value)
  if (!p) return ""
  return `${WEEKDAY_NAMES[weekdayOf(value)]}, ${p.day} ${MONTH_NAMES[p.month - 1]} ${p.year}`
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------------------------------------------------------------------

/** Keeps digits and inserts the dashes as the person types: "19850412" -> "1985-04-12". Separators typed by hand (- / . space) are accepted. */
export function maskDateInput(text: string): string {
  // A pasted date with hand-typed separators ("1985/4/2"). A one-digit DAY after a two-digit month ("1985-04-1") is left alone: the person is still typing.
  const flexible = /^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/.exec(text.trim())
  if (flexible && (flexible[3].length === 2 || flexible[2].length === 1)) return `${flexible[1]}-${pad(Number(flexible[2]))}-${pad(Number(flexible[3]))}`
  // A separator typed after a single-digit month ("2024-2/") pads it ("2024-02-") so typing 2024/2/29 by hand works too.
  const partial = /^(\d{4})[-/. ](\d)[-/. ](\d{0,2})$/.exec(text.trim())
  if (partial) return `${partial[1]}-${pad(Number(partial[2]))}-${partial[3]}`.replace(/-$/, partial[3] === "" ? "-" : "")
  const digits = text.replace(/\D/g, "").slice(0, 8)
  if (digits.length <= 4) return digits
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
}

/** Applied when the person leaves the field: "1985-04-2" -> "1985-04-02". */
export function finalizeDateInput(text: string): string {
  const m = /^(\d{4})-(\d{2})-(\d)$/.exec(text)
  return m ? `${m[1]}-${m[2]}-0${m[3]}` : text
}

export type TypedDate =
  | { kind: "empty" }
  | { kind: "partial" }
  | { kind: "invalid"; message: string }
  | { kind: "ok"; value: string }

export function interpretTypedDate(text: string): TypedDate {
  const masked = maskDateInput(text)
  if (masked === "") return { kind: "empty" }
  if (masked.length < 10) return { kind: "partial" }
  const m = STRICT.exec(masked)
  if (!m) return { kind: "invalid", message: `Enter the date as ${DATE_ONLY_FORMAT}.` }
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (year < 1) return { kind: "invalid", message: "Enter a valid year." }
  if (month < 1 || month > 12) return { kind: "invalid", message: `${m[2]} is not a month (01–12).` }
  if (day < 1 || day > daysInMonth(year, month)) {
    return { kind: "invalid", message: month === 2 && day === 29 ? `${year} is not a leap year, so it has no 29 February.` : `${MONTH_NAMES[month - 1]} ${year} has no day ${m[3]}.` }
  }
  return { kind: "ok", value: masked }
}

export interface DateRules {
  min?: string
  max?: string
  required?: boolean
}

/** The message to show for a committed value ("" = empty) under the field's rules, or null when it is acceptable. */
export function validateDateOnly(value: string, rules: DateRules = {}): string | null {
  if (value === "") return rules.required ? "This date is required." : null
  if (!parseDateOnly(value)) return `Enter the date as ${DATE_ONLY_FORMAT}.`
  const min = rules.min ?? DEFAULT_MIN_DATE
  const max = rules.max ?? DEFAULT_MAX_DATE
  if (compareDateOnly(value, min) < 0) return `The date must be on or after ${min}.`
  if (compareDateOnly(value, max) > 0) return `The date must be on or before ${max}.`
  return null
}
