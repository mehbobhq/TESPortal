"use client"

import { useEffect, useMemo, useState } from "react"
import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import type { VehicleRecord } from "@/src/types"

interface VehicleSettings {
  travelsNY: boolean
  travelsNM: boolean
  travelsKY: boolean
  travelsOR: boolean
  travelsCT: boolean
  travelsCA: boolean
  carriesOSOW: boolean
  carriesAlcohol: boolean
  carriesTobacco: boolean
  carriesHazmat: boolean
  operatesLCV: boolean
  operatesAxleLift: boolean
  eldDeviceId: string
  gpsProvider: string
  complianceNotes: string
}

function defaultVehicleSettings(): VehicleSettings {
  return {
    travelsNY: false, travelsNM: false, travelsKY: false,
    travelsOR: false, travelsCT: false, travelsCA: false,
    carriesOSOW: false, carriesAlcohol: false,
    carriesTobacco: false,
    carriesHazmat: false, operatesLCV: false,
    operatesAxleLift: false, eldDeviceId: "",
    gpsProvider: "", complianceNotes: "",
  }
}

function loadVehicleSettings(
  companyId: string,
  vehicleId: string
): VehicleSettings {
  try {
    const raw = localStorage.getItem(
      `tes_vehicle_settings_${companyId}_${vehicleId}`
    )
    return raw ? { ...defaultVehicleSettings(), ...JSON.parse(raw) } : defaultVehicleSettings()
  } catch {
    return defaultVehicleSettings()
  }
}

function saveVehicleSettings(
  companyId: string,
  vehicleId: string,
  settings: VehicleSettings
): void {
  try {
    localStorage.setItem(
      `tes_vehicle_settings_${companyId}_${vehicleId}`,
      JSON.stringify(settings)
    )
  } catch {}
}

const PERMIT_PROGRAM_ROWS: { key: keyof VehicleSettings; label: string; desc: string }[] = [
  { key: "travelsNY", label: "Does this unit cross into New York?", desc: "Required for NY Highway Use Tax (HUT)" },
  { key: "travelsNM", label: "Does this unit cross into New Mexico?", desc: "Required for NM Weight Distance Tax (WDT)" },
  { key: "travelsKY", label: "Does this unit cross into Kentucky?", desc: "Required for KY Weight Distance Tax (KYU)" },
  { key: "travelsOR", label: "Does this unit cross into Oregon?", desc: "Required for OR Weight-Mile Tax" },
  { key: "travelsCT", label: "Does this unit cross into Connecticut?", desc: "Required for CT Highway Use Tax" },
  { key: "travelsCA", label: "Does this unit cross into California?", desc: "Required for CA DMV operating authority" },
  { key: "carriesOSOW", label: "Does this unit haul oversize or overweight loads?", desc: "Triggers OSOW permit requirements per jurisdiction" },
  { key: "carriesAlcohol", label: "Does this unit transport beverage alcohol?", desc: "Required for liquor transport endorsement and compliance" },
  { key: "carriesTobacco", label: "Does this unit transport tobacco products?", desc: "Required for tobacco excise tax and transport compliance" },
  { key: "carriesHazmat", label: "Does this unit transport dangerous goods?", desc: "Required for TDG/HMR compliance, placarding, and routing" },
  { key: "operatesLCV", label: "Does this unit operate as a Long Combination Vehicle?", desc: "Required for LCV permits in AB, SK, and MB" },
  { key: "operatesAxleLift", label: "Does this unit operate with an axle lift?", desc: "Affects axle weight compliance and permit calculations" },
]

const CANADA_ONLY_DISABLED_KEYS: (keyof VehicleSettings)[] = [
  "travelsNY", "travelsNM", "travelsKY", "travelsOR", "travelsCT", "travelsCA", "carriesAlcohol", "carriesTobacco",
]

function readCompanyLoadTypes(companyId: string): string[] {
  try {
    const raw = localStorage.getItem(`tes_company_compliance_settings_${companyId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { rules?: Record<string, string> }
    const rules = parsed.rules || {}
    const types: string[] = []
    if (rules.dg_us === "applies" || rules.dg_canada === "applies") types.push("hazmat")
    return types
  } catch {
    return []
  }
}

function SettingsToggleRow({ label, description, checked, onCheckedChange, disabled = false, title }: { label: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border">
      <div className="pr-4">
        <p className="text-sm font-medium text-foreground">
          {label}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        title={title}
        onClick={() => onCheckedChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer
          rounded-full border-2 border-transparent transition-colors
          focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-primary focus-visible:ring-offset-2
          ${checked ? "bg-primary" : "bg-input"}
          ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
      >
        <span className={`pointer-events-none inline-block size-4
          rounded-full bg-background shadow-lg ring-0 transition-transform
          ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
    </div>
  )
}

export interface SettingsTabProps {
  companyId: string
  vehicle: VehicleRecord
  onSaved?: () => void
  addVehicleActivity: (
    companyId: string,
    vehicleId: string,
    entry: {
      event: string
      detail: string
      section: string
    }
  ) => void
}

export function SettingsTab({ companyId, vehicle, onSaved, addVehicleActivity }: SettingsTabProps) {
  const [saved, setSaved] = useState<VehicleSettings>(() => loadVehicleSettings(companyId, vehicle.id))
  const [draft, setDraft] = useState<VehicleSettings>(saved)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    const loaded = loadVehicleSettings(companyId, vehicle.id)
    setSaved(loaded)
    setDraft(loaded)
    setSavedAt(null)
  }, [companyId, vehicle.id])

  const set = <K extends keyof VehicleSettings>(key: K, value: VehicleSettings[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const isDirty = JSON.stringify(saved) !== JSON.stringify(draft)

  const isCanadaOnly = vehicle.operatingRegion === "Canada Only"

  const companyLoadTypes = useMemo(() => readCompanyLoadTypes(companyId), [companyId])
  const hasHazmatLoadType = companyLoadTypes.includes("hazmat")
  const showHazmat = hasHazmatLoadType && (vehicle.operatingRegion === "US Only" || vehicle.operatingRegion === "Cross-Border")

  const visibleRows = PERMIT_PROGRAM_ROWS.filter((row) => row.key !== "carriesHazmat" || showHazmat)

  const handleSave = () => {
    saveVehicleSettings(companyId, vehicle.id, draft)
    setSaved(draft)
    addVehicleActivity(companyId, vehicle.id, {
      event: "SETTINGS_UPDATED",
      detail: "Vehicle compliance settings updated.",
      section: "settings",
    })
    setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))
    onSaved?.()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permit Programs</CardTitle>
          <CardDescription>Mark which jurisdictions and cargo programs apply to this specific unit.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {isCanadaOnly ? (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Some permit programs are disabled because this unit's Operating Region is set to Canada Only.
            </div>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            {visibleRows.map((row) => {
              const disabled = isCanadaOnly && CANADA_ONLY_DISABLED_KEYS.includes(row.key)
              return (
                <SettingsToggleRow
                  key={row.key}
                  label={row.label}
                  description={row.desc}
                  checked={draft[row.key] as boolean}
                  onCheckedChange={(value) => set(row.key, value as VehicleSettings[typeof row.key])}
                  disabled={disabled}
                  title={disabled ? "Not applicable — Operating Region is Canada Only" : undefined}
                />
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Telematics & Tracking</CardTitle>
          <CardDescription>Device identifiers linked to this unit.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 pt-0 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="eldDeviceId">ELD Device ID</Label>
            <Input id="eldDeviceId" value={draft.eldDeviceId} onChange={(e) => set("eldDeviceId", e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Device serial number linked to this vehicle</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="settingsGpsProvider">GPS / Telematics Provider</Label>
            <Input id="settingsGpsProvider" value={draft.gpsProvider} onChange={(e) => set("gpsProvider", e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Fleet tracking provider for this unit</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compliance Notes</CardTitle>
          <CardDescription>Internal-only observations for this vehicle.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <Label htmlFor="complianceNotes">Internal Notes</Label>
          <Textarea id="complianceNotes" rows={4} value={draft.complianceNotes} onChange={(e) => set("complianceNotes", e.target.value)} />
          <p className="text-[11px] text-muted-foreground">Compliance program exceptions or special handling for this vehicle</p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          {isDirty ? (
            <>
              <div className="text-sm font-medium">Unsaved changes</div>
              <p className="text-xs text-muted-foreground">Your changes are not active until you save these settings.</p>
            </>
          ) : savedAt ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" />Saved {savedAt}</span>
          ) : (
            <p className="text-xs text-muted-foreground">No changes yet.</p>
          )}
        </div>
        <Button type="button" onClick={handleSave} disabled={!isDirty}>
          <Check className="mr-2 size-4" />
          Save Settings
        </Button>
      </div>
    </div>
  )
}
