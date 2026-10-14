/**
 * Deadline reading for the restored Insurance workspace: whole calendar days from a reference date and the Healthy / Watch /
 * Urgent / Critical / Expired bands the original interface used (>60, 31-60, 11-30, 0-10, past). Pure; reads no browser state.
 * The reference date is passed in (the canonical API's own as-of date), never taken from a stored value.
 */

export type DeadlineStatus = "Healthy" | "Watch" | "Urgent" | "Critical" | "Expired" | "No Deadline"

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days from `today` (YYYY-MM-DD) to the end of `target` (YYYY-MM-DD); null when either is not a date. */
export function getDaysRemaining(target: string | null | undefined, today: string): number | null {
  if (!target || !/^\d{4}-\d{2}-\d{2}$/.test(target) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null
  const end = Date.parse(`${target}T23:59:59Z`)
  const from = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(end) || Number.isNaN(from)) return null
  return Math.ceil((end - from) / DAY_MS)
}

export function getDeadlineStatus(target: string | null | undefined, today: string): DeadlineStatus {
  const days = getDaysRemaining(target, today)
  if (days === null) return "No Deadline"
  if (days < 0) return "Expired"
  if (days <= 10) return "Critical"
  if (days <= 30) return "Urgent"
  if (days <= 60) return "Watch"
  return "Healthy"
}

export function getDeadlineClasses(status: DeadlineStatus): { badge: string; indicator: string } {
  switch (status) {
    case "Healthy":
      return { badge: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300", indicator: "bg-emerald-500" }
    case "Watch":
      return { badge: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300", indicator: "bg-amber-400" }
    case "Urgent":
      return { badge: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300", indicator: "bg-orange-500" }
    case "Critical":
      return { badge: "border-red-400 bg-red-100 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 font-semibold", indicator: "bg-red-600 animate-pulse" }
    case "Expired":
      return { badge: "border-red-900 bg-red-950 text-white dark:border-red-700 dark:bg-red-900 font-bold", indicator: "bg-red-900" }
    default:
      return { badge: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400", indicator: "bg-slate-400" }
  }
}
