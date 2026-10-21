"use client"

import { CompanyMissing } from "@/components/company-missing"
import { readCompanyLookup } from "@/lib/company-lookup"
import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const VEHICLE_TYPES = ["TRUCK_TRACTOR", "STRAIGHT_TRUCK", "TRAILER", "OTHER"]
const RELATIONSHIPS = ["OPERATES", "OWNS", "LEASES"]

type VehicleRow = {
  relationshipId: string
  vehicleId: string
  relationshipType: string
  unitNumber: string | null
  vehicleType: string
  vin: string | null
  modelYear: number | null
  make: string | null
  model: string | null
  vehicleStatus: string
}
type Company = { id: string; name: string; kind: string; status: string }

/**
 * The canonical (PostgreSQL-backed) Vehicles register. It is kept intact but is NOT rendered by the Vehicles route (see ./page.tsx) and is not
 * a route itself: the Vehicles page shows the original detailed workspace. Its API (/api/companies/[id]/vehicles), services, tables and
 * records are unchanged. Re-mounting it is a deliberate product decision, not a flag.
 */
export function CanonicalVehicles() {
  const params = useParams()
  const companyId = params.id as string
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const [company, setCompany] = useState<Company | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [vehicles, setVehicles] = useState<VehicleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [profile, list] = await Promise.all([
        fetch(`${base}/profile`, { cache: "no-store" }),
        fetch(`${base}/vehicles`, { cache: "no-store" }),
      ])
      {
          const lookup = await readCompanyLookup<Company>(profile)
          setCompany(lookup.company)
          setLookupFailed(lookup.failed)
        }
      if (list.ok) setVehicles((await list.json()).vehicles ?? [])
      else setError((await list.json().catch(() => null))?.error ?? "Unable to load vehicles.")
    } catch {
      setError("Unable to load vehicles.")
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const field = (name: string) => String(data.get(name) ?? "").trim()
    const payload: Record<string, unknown> = {
      vehicleTypeCode: field("vehicleTypeCode"),
      relationshipType: field("relationshipType"),
      vin: field("vin"),
      make: field("make"),
      model: field("model"),
      unitNumber: field("unitNumber"),
    }
    if (field("modelYear")) payload.modelYear = Number(field("modelYear"))
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`${base}/vehicles`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      if (!response.ok) setError((await response.json().catch(() => null))?.error ?? "The vehicle could not be saved.")
      else {
        form.reset()
        await load()
      }
    } catch {
      setError("The vehicle could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <CompanyMissing failed={lookupFailed} />

  return (
    <div className="flex flex-col gap-6 pb-10">
      <CompanyWorkspaceHeader company={company} section="Vehicles" />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b">
          <CardTitle className="text-sm">Vehicles on record</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {vehicles.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No vehicles yet.</p>
          ) : (
            <div className="flex flex-col divide-y">
              {vehicles.map((row) => (
                <div key={row.relationshipId} className="py-3">
                  <p className="text-sm font-semibold">
                    {row.unitNumber ? `Unit ${row.unitNumber} — ` : ""}
                    {[row.modelYear, row.make, row.model].filter(Boolean).join(" ") || row.vehicleType}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {row.relationshipType} · {row.vehicleType} · VIN {row.vin ?? "—"} · {row.vehicleStatus}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b">
          <CardTitle className="text-sm">Add vehicle</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleCreate} className="grid sm:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label htmlFor="vehicleTypeCode">Type</Label>
              <select id="vehicleTypeCode" name="vehicleTypeCode" required className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                {VEHICLE_TYPES.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="relationshipType">Relationship</Label>
              <select id="relationshipType" name="relationshipType" required className="w-full rounded-md border bg-background px-2 py-2 text-sm">
                {RELATIONSHIPS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="unitNumber">Unit number</Label>
              <Input id="unitNumber" name="unitNumber" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vin">VIN</Label>
              <Input id="vin" name="vin" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="modelYear">Year</Label>
              <Input id="modelYear" name="modelYear" inputMode="numeric" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="make">Make</Label>
              <Input id="make" name="make" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="model">Model</Label>
              <Input id="model" name="model" />
            </div>
            <div className="flex items-end justify-end">
              <Button type="submit" disabled={busy}>Save vehicle</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Permits, inspections, repair bills, ownership and registration documents, and vehicle evidence are deferred: they have no
        canonical PostgreSQL storage yet.
      </p>
    </div>
  )
}
