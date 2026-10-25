"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { setCanonicalVehicleRecordsProvider } from "@/lib/vehicle-data"
import { CanonicalVehicleChoicesProvider } from "@/src/components/drivers/canonical-vehicle-choices"
import { DriverPerformanceEventWorkflow } from "@/src/components/drivers/DriverPerformanceEventWorkflow"
import { wizardPayloadToEventInput, type WizardPayload } from "@/lib/driver-events/legacy-adapter"
import { IANA_TIME_ZONES } from "@/lib/performance-near-miss-taxonomy"
import type { CompanyDriverRelationship, DriverPerformanceEvent } from "@/types/drivers"
import { EventsApiError, eventsApi, type DriverOption, type VehicleOption } from "./events-api"
import { Label, inputClass } from "./field-input"

const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto" } catch { return "America/Toronto" } }

/**
 * Opens one of the six detailed workflows (Collision, Near Miss, Roadside Inspection, Cargo Incident, Spill or Release, Customer Event) against the canonical
 * store. The wizard itself is unchanged: it offers the company's CANONICAL vehicles, and what it produces is converted and sent to the server, which validates
 * it again. Nothing is written to the browser.
 */
export function DetailedWizardHost({ companyId, category, drivers, vehicles, onSaved, onCancel }: {
  companyId: string; category: DriverPerformanceEvent["eventType"]; drivers: DriverOption[]; vehicles: VehicleOption[]; onSaved: (id: string, notice?: string) => void; onCancel: () => void
}) {
  const api = useMemo(() => eventsApi(companyId), [companyId])
  const [driver, setDriver] = useState("")
  const [zone, setZone] = useState(browserZone())
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The wizard calls onSave and then onClose in the same tick; while the save is in flight the wizard must stay open so a refusal is shown and nothing typed is lost.
  const saving = useRef(false)
  const choices = useMemo(() => {
    const row = (v: VehicleOption) => ({ id: v.relationshipId, unitNumber: v.unitNumber, equipmentType: v.vehicleType })
    return { powerUnits: vehicles.filter((v) => !/trailer/i.test(v.vehicleType)).map(row), trailers: vehicles.filter((v) => /trailer/i.test(v.vehicleType)).map(row) }
  }, [vehicles])
  const relationship = useMemo(() => ({ id: driver, companyId, driverMasterId: driver }) as unknown as CompanyDriverRelationship, [driver, companyId])

  // Inspected equipment is resolved against the company's canonical vehicles while the wizard is open.
  useEffect(() => {
    setCanonicalVehicleRecordsProvider(() => vehicles.map((v) => ({
      companyId,
      vehicle: { id: v.relationshipId, vin: v.vin ?? "", unitNumber: v.unitNumber, status: "Active", equipmentType: v.vehicleType } as never,
      store: { registrationRecords: [] } as never,
    })))
    return () => setCanonicalVehicleRecordsProvider(null)
  }, [vehicles, companyId])

  async function save(payload: WizardPayload) {
    saving.current = true
    setError(null)
    try {
      const { input, followUp } = wizardPayloadToEventInput(payload, { driverRelationshipId: driver, timeZone: zone })
      const created = await api.create(input)
      let notice = created.possibleDuplicates.length ? `Saved. ${created.possibleDuplicates.length} possible duplicate(s) found - review them on the event.` : undefined
      if (followUp) {
        try { await api.action(created.id, { action: "add", actionType: "CORRECTIVE", title: followUp.title, dueDate: followUp.dueDate, required: true, ownerLabel: "Unassigned (assign an owner)" }) } catch { notice = `${notice ?? "Saved."} The follow-up could not be created; add it on the event.` }
      }
      onSaved(created.id, notice)
    } catch (e) {
      setError(e instanceof EventsApiError ? [e.message, ...e.issues.slice(1, 4).map((i) => i.message)].join(" · ") : "The event could not be saved.")
    } finally {
      saving.current = false
    }
  }

  if (!started) {
    return (
      <div className="max-w-xl space-y-4 rounded-2xl border border-border p-5" data-testid="wizard-start">
        <h3 className="text-sm font-bold">{category}</h3>
        <p className="text-xs text-muted-foreground">The detailed {category.toLowerCase()} workflow records this event against the company&apos;s own driver and vehicle records.</p>
        <div>
          <Label htmlFor="wh-driver" required>Driver</Label>
          <select id="wh-driver" className={inputClass} value={driver} onChange={(e) => setDriver(e.target.value)}>
            <option value="">Select…</option>
            {drivers.map((d) => <option key={d.relationshipId} value={d.relationshipId}>{d.label}</option>)}
          </select>
          {drivers.length === 0 ? <p className="mt-1 text-[11px] text-destructive">This company has no drivers on record yet.</p> : null}
        </div>
        <div>
          <Label htmlFor="wh-zone">Time zone the event happened in</Label>
          <select id="wh-zone" className={inputClass} value={zone} onChange={(e) => setZone(e.target.value)}>
            {[...new Set([zone, ...IANA_TIME_ZONES.map((z: { value: string } | string) => (typeof z === "string" ? z : z.value))])].map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={!driver} onClick={() => setStarted(true)}>Start</Button></div>
      </div>
    )
  }
  return (
    <>
      {error ? <div role="alert" data-testid="wizard-error" className="fixed left-1/2 top-4 z-[60] max-w-xl -translate-x-1/2 rounded-xl border border-destructive/40 bg-background px-4 py-2 text-xs text-destructive shadow-lg">{error}</div> : null}
      <CanonicalVehicleChoicesProvider value={choices}>
        <DriverPerformanceEventWorkflow
          relationship={relationship}
          trainings={[]}
          evidence={[]}
          companyRegJurisdiction=""
          initialEntryMode="MANUAL"
          initialCategory={category}
          evidenceOnSavedEvent
          onClose={() => { if (!saving.current) onCancel() }}
          onSave={(data) => void save(data as unknown as WizardPayload)}
        />
      </CanonicalVehicleChoicesProvider>
    </>
  )
}
