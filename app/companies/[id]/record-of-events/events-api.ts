import type { EventInput } from "@/lib/driver-events/validation"

export type Issue = { field: string; message: string }
export class EventsApiError extends Error {
  readonly issues: Issue[]
  readonly status: number
  constructor(message: string, status: number, issues: Issue[] = []) {
    super(message)
    this.status = status
    this.issues = issues
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new EventsApiError(body?.error ?? "The request could not be completed.", response.status, Array.isArray(body?.issues) ? body.issues : [])
  return body as T
}
const send = (method: string, url: string, body?: unknown) => call<any>(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })

export type EventRow = {
  id: string; category: string; category_code: string; title: string; status: string; record_state: string; occurrence_precision: string; occurred_at: string | null
  occurred_local_date: string | null; occurred_time_zone: string | null; observed_severity: string; verification_state: string; driver_relationship_id: string | null
  vehicle_id: string | null; current_version: number; created_at: string; active_restrictions: number; is_duplicate: boolean
}
export type DriverOption = { relationshipId: string; label: string }
export type VehicleOption = { relationshipId: string; vehicleId: string; unitNumber: string; vehicleType: string; vin: string | null }

export function eventsApi(companyId: string) {
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const ev = `${base}/driver-events`
  const one = (id: string) => `${ev}/${encodeURIComponent(id)}`
  return {
    list: async (filters: Record<string, string> = {}) => (await call<{ events: EventRow[] }>(`${ev}?${new URLSearchParams(filters)}`)).events,
    get: (id: string) => call<any>(one(id)),
    create: (input: EventInput) => send("POST", ev, input) as Promise<{ id: string; version: number; possibleDuplicates: { id: string; title: string; basis: string }[] }>,
    correct: (id: string, expectedVersion: number, event: EventInput, reason: string) => send("PUT", one(id), { expectedVersion, event, reason }),
    status: (id: string, to: string, reason?: string) => send("POST", `${one(id)}/status`, { to, reason }),
    evidence: (id: string, body: Record<string, unknown>) => send("POST", `${one(id)}/evidence`, body),
    relationship: (id: string, body: Record<string, unknown>) => send("POST", `${one(id)}/relationships`, body),
    consequence: (id: string, body: Record<string, unknown>) => send("POST", `${one(id)}/consequences`, body),
    action: (id: string, body: Record<string, unknown>) => send("POST", `${one(id)}/actions`, body),
    restriction: (id: string, body: Record<string, unknown>) => send("POST", `${one(id)}/restrictions`, body),
    duplicates: async (id: string) => (await call<{ possibleDuplicates: { id: string; title: string; basis: string }[] }>(`${one(id)}/duplicates`)).possibleDuplicates,
    drivers: async (): Promise<DriverOption[]> =>
      ((await call<{ drivers: any[] }>(`${base}/drivers`)).drivers ?? []).map((d) => ({ relationshipId: d.relationshipId, label: [d.givenName, d.familyName].filter(Boolean).join(" ") || d.driverNumber || d.relationshipId })),
    vehicles: async (): Promise<VehicleOption[]> =>
      ((await call<{ vehicles: any[] }>(`${base}/vehicles`)).vehicles ?? []).map((v) => ({ relationshipId: v.relationshipId, vehicleId: v.vehicleId, unitNumber: v.unitNumber ?? v.vin ?? v.relationshipId, vehicleType: v.vehicleType, vin: v.vin ?? null })),
    uploadEvidence: async (file: File, title: string) => {
      const form = new FormData()
      form.set("file", file)
      form.set("documentType", "DRIVER_EVENT_EVIDENCE")
      form.set("documentTitle", title)
      const response = await fetch(`${base}/evidence`, { method: "POST", body: form })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new EventsApiError(body?.error ?? "The upload could not be completed.", response.status)
      return body as { documentId: string; state: string }
    },
    finalizeEvidence: (documentId: string) => send("PATCH", `${base}/evidence/${encodeURIComponent(documentId)}`, { action: "finalize" }) as Promise<{ evidence: { documentId: string; payload: { state: string } }[] }>,
    facts: async (q: Record<string, string> = {}) => call<{ contract: string; facts: any[] }>(`${ev}/facts?${new URLSearchParams(q)}`),
  }
}
