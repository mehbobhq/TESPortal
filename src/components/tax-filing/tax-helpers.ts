import type { FilingFrequency } from "./types"

export function isoNow() {
  return new Date().toISOString()
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
