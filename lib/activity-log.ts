/**
 * TES Company Activity Feed — the operational log visible to fleet owners
 * on a company's Profile page. This is a separate system from the
 * System-Administrator Audit Log (lib/audit-log.ts) and must never be
 * merged with it.
 */

const MAX_ENTRIES = 1000

export interface ActivityEntry {
  id: string // nanoid or crypto.randomUUID()
  t: string // ISO 8601
  section: string // "vehicles" | "drivers" | "insurance" | ...
  entityId?: string
  entityLabel?: string
  action: string // human-readable past tense
  detail?: string
  userId?: string
  userName?: string
}

function storageKey(companyId: string): string {
  return `tes_activity_${companyId}`
}

function createId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `act-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readAll(companyId: string): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(companyId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function logActivity(companyId: string, entry: Omit<ActivityEntry, "id" | "t">): void {
  try {
    const existing = readAll(companyId)
    const next: ActivityEntry = {
      ...entry,
      id: createId(),
      t: new Date().toISOString(),
    }
    const updated = [...existing, next]
    const trimmed = updated.length > MAX_ENTRIES ? updated.slice(updated.length - MAX_ENTRIES) : updated
    localStorage.setItem(storageKey(companyId), JSON.stringify(trimmed))
  } catch {
    // Never throw.
  }
}

export function readActivity(companyId: string, section?: string): ActivityEntry[] {
  const entries = readAll(companyId)
  const filtered = section ? entries.filter((entry) => entry.section === section) : entries
  return [...filtered].sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime())
}
