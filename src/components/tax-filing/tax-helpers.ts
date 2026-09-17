import type { FilingFrequency } from "./types"

export function isoNow() {
  return new Date().toISOString()
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

export function formatFrequency(value: FilingFrequency) {
  switch (value) {
    case "monthly": return "Monthly"
    case "quarterly": return "Quarterly"
    case "annual": return "Annual"
    case "event-based": return "Event-based"
    case "historical-only": return "Historical only"
    default: return "Not set"
  }
}