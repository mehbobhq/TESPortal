/** TES Driver canonical date helpers.
 * Canonical storage/input format: YYYY-MM-DD.
 */
export const DRIVER_DATE_FORMAT = "YYYY-MM-DD" as const

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/

function validParts(year: number, month: number, day: number) {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

export function normalizeDriverDate(value: unknown): string {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  const iso = raw.match(DATE_ONLY)
  if (iso && validParts(+iso[1], +iso[2], +iso[3])) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const compact = raw.match(COMPACT)
  if (compact && validParts(+compact[1], +compact[2], +compact[3])) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const dt = raw.match(/^(\d{4})-(\d{2})-(\d{2})T/)
  if (dt && validParts(+dt[1], +dt[2], +dt[3])) return `${dt[1]}-${dt[2]}-${dt[3]}`
  return ""
}

export function requireDriverDate(value: unknown, label = "Date"): string {
  const normalized = normalizeDriverDate(value)
  if (!normalized) throw new Error(`${label} must be a complete valid date in YYYY-MM-DD format.`)
  return normalized
}

export function driverDateInputValue(value: unknown): string {
  return normalizeDriverDate(value)
}
