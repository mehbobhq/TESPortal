/**
 * Timestamps with a time zone, kept apart from calendar dates (see date-only.ts).
 *
 * An event's occurrence is an INSTANT. People enter it as wall-clock time in a named IANA zone ("2026-03-08T02:30 in America/Toronto"); this module
 * converts between that and the UTC instant without relying on the browser's own zone, and reports the two awkward cases honestly:
 *   - a wall-clock time that does not exist (the hour skipped when clocks go forward), and
 *   - a wall-clock time that happens twice (the hour repeated when clocks go back).
 */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()
function formatterFor(timeZone: string) {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    formatterCache.set(timeZone, f)
  }
  return f
}

/** Offset of the zone from UTC at an instant, in minutes (Toronto in winter = -300). */
export function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"))
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60000)
}

export type ZonedResult = { ok: true; instant: string; ambiguous: boolean } | { ok: false; reason: "invalid" | "gap" | "zone" }

/** "YYYY-MM-DDTHH:mm" wall-clock time in `timeZone` -> UTC instant ("...Z"). For a repeated hour the earlier instant is used and `ambiguous` is true. */
export function zonedLocalToInstant(local: string, timeZone: string): ZonedResult {
  if (!isValidTimeZone(timeZone)) return { ok: false, reason: "zone" }
  const m = LOCAL.exec(local)
  if (!m) return { ok: false, reason: "invalid" }
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const naive = Date.UTC(y, mo - 1, d, h, mi)
  const check = new Date(naive)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return { ok: false, reason: "invalid" }
  const offsets = new Set([offsetMinutesAt(naive - 86400000, timeZone), offsetMinutesAt(naive + 86400000, timeZone)])
  const valid: number[] = []
  for (const off of offsets) {
    const t = naive - off * 60000
    if (offsetMinutesAt(t, timeZone) === off) valid.push(t)
  }
  if (valid.length === 0) return { ok: false, reason: "gap" }
  valid.sort((a, b) => a - b)
  return { ok: true, instant: new Date(valid[0]).toISOString(), ambiguous: valid.length > 1 }
}

/** UTC instant -> "YYYY-MM-DDTHH:mm" wall-clock time in `timeZone`. */
export function instantToZonedLocal(instant: string, timeZone: string): string {
  const ms = Date.parse(instant)
  if (Number.isNaN(ms) || !isValidTimeZone(timeZone)) return ""
  const parts = formatterFor(timeZone).formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}T${String(Number(get("hour")) % 24).padStart(2, "0")}:${get("minute")}`
}

/** "EDT (UTC−04:00)" style label for a zone at an instant. */
export function zoneLabel(timeZone: string, instantMs: number = Date.now()): string {
  if (!isValidTimeZone(timeZone)) return timeZone
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date(instantMs)).find((p) => p.type === "timeZoneName")?.value ?? timeZone
  const off = offsetMinutesAt(instantMs, timeZone)
  const sign = off < 0 ? "−" : "+"
  const abs = Math.abs(off)
  return `${name} (UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")})`
}

export const LOCAL_DATETIME_PATTERN = LOCAL
