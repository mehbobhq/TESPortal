"use client"

import { useEffect, useId, useState } from "react"
import type { ComponentType, Dispatch, ReactNode, SetStateAction } from "react"
import { Edit3, Search, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { createId, isoNow } from "@/lib/vehicle-data"
import { normalizeVIN } from "@/lib/identifier-normalization"
import {
  findVehicleManufacturer,
  formatVehicleModel,
  manufacturersForEquipment,
  normalizeVehicleManufacturer,
} from "@/lib/vehicle-manufacturers"
import type { EquipmentType, VehicleRecord, VehicleStatus } from "@/src/types"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"

const VEHICLE_TYPES: EquipmentType[] = [
  "Tractor",
  "Trailer - Dry Van",
  "Trailer - Reefer",
  "Trailer - Flatbed",
  "Trailer - Step Deck / Lowboy",
  "Trailer - Intermodal Chassis",
  "Converter Dolly",
  "Straight Truck",
  "Service Vehicle",
  "Other Equipment",
]
const VEHICLE_STATUSES: VehicleStatus[] = [
  "Active",
  "Maintenance",
  "Out of Service",
  "Inactive",
]
const inputClass = "h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
const selectClass = inputClass

type VehicleProfileFieldComponent = ComponentType<{ label: string; children: ReactNode; required?: boolean; className?: string }>
type VehicleProfileSectionTitleComponent = ComponentType<{ title: string; description?: string; action?: ReactNode }>

export type VehicleProfileRecord = VehicleRecord & {
  fleetStartDate?: string
  fleetEndDate?: string
  tareWeightUnit?: "kg" | "lb"
  equipmentLengthUnit?: "ft" | "m"
}

export interface ProfileForm {
  unitNumber: string
  equipmentType: EquipmentType
  status: VehicleStatus
  vin: string
  year: string
  make: string
  model: string
  color: string
  operatingRegion: VehicleRecord["operatingRegion"]
  axles: string
  fleetStartDate: string
  fleetEndDate: string
  tareWeight: string
  tareWeightUnit: "kg" | "lb"
  fuelType: VehicleRecord["fuelType"]
  equipmentLength: string
  equipmentLengthUnit: "ft" | "m"
  gpsProvider: string
}

export function profileFromVehicle(vehicle: VehicleRecord): ProfileForm {
  const profileVehicle = vehicle as VehicleProfileRecord
  const manufacturer = normalizeVehicleManufacturer(vehicle.make || "", vehicle.equipmentType)
  return {
    unitNumber: vehicle.unitNumber || "",
    equipmentType: vehicle.equipmentType,
    status: vehicle.status === "Archived" ? "Inactive" : vehicle.status,
    vin: vehicle.vin || "",
    year: vehicle.year || "",
    make: manufacturer.name,
    model: formatVehicleModel(vehicle.model || ""),
    color: vehicle.color || "",
    operatingRegion: vehicle.operatingRegion,
    axles: String(vehicle.axles ?? ""),
    fleetStartDate: profileVehicle.fleetStartDate || "",
    fleetEndDate: profileVehicle.fleetEndDate || "",
    tareWeight: profileVehicle.tareWeightKgs !== undefined ? String(profileVehicle.tareWeightKgs) : "",
    tareWeightUnit: profileVehicle.tareWeightUnit || "kg",
    fuelType: vehicle.fuelType,
    equipmentLength: profileVehicle.lengthFeet || "",
    equipmentLengthUnit: profileVehicle.equipmentLengthUnit || "ft",
    gpsProvider: vehicle.gpsProvider || "",
  }
}

export function buildVehicle(form: ProfileForm, existing?: VehicleRecord): VehicleRecord {
  const tareKg = form.tareWeightUnit === "kg" ? Number(form.tareWeight) : Number(form.tareWeight) * 0.45359237
  const lengthFt = form.equipmentLengthUnit === "ft" ? form.equipmentLength : Number.isFinite(Number(form.equipmentLength)) ? String(Number(form.equipmentLength) * 3.280839895) : ""
  const now = isoNow()
  const manufacturer = normalizeVehicleManufacturer(form.make, form.equipmentType)
  const record: VehicleProfileRecord = {
    id: existing?.id || createId("VEH"),
    unitNumber: form.unitNumber.trim(),
    equipmentType: form.equipmentType,
    status: form.status,
    vin: normalizeVIN(form.vin),
    year: form.year.trim(),
    make: manufacturer.name,
    model: formatVehicleModel(form.model),
    color: form.color.trim(),
    operatingRegion: form.operatingRegion,
    axles: Number(form.axles) || 0,
    lengthFeet: lengthFt,
    tareWeightKgs: Number.isFinite(tareKg) && form.tareWeight !== "" ? Math.round(tareKg * 100) / 100 : undefined,
    fuelType: form.fuelType,
    gpsProvider: form.gpsProvider.trim(),
    transponderNumber: existing?.transponderNumber,
    fleetStartDate: form.fleetStartDate || undefined,
    fleetEndDate: form.fleetEndDate || undefined,
    tareWeightUnit: form.tareWeightUnit,
    equipmentLengthUnit: form.equipmentLengthUnit,
    manufacturerCode: manufacturer.code || undefined,
    ownershipType: existing?.ownershipType || "Owned",
    ownerCompanyName: existing?.ownerCompanyName,
    purchaseDate: existing?.purchaseDate,
    purchasePrice: existing?.purchasePrice,
    leaseTermMonths: existing?.leaseTermMonths,
    leaseEndDate: existing?.leaseEndDate,
    registration: existing?.registration,
    permits: existing?.permits || [],
    inspections: existing?.inspections || [],
    evidenceIds: existing?.evidenceIds || [],
    source: existing?.source || "Manual",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    notes: existing?.notes,
  }
  return record
}

export function ProfileTab({ companyId, vehicle, onSave, onStartOCR, ocrValues, FieldComponent, SectionTitleComponent }: { companyId: string; vehicle: VehicleRecord; onSave: (vehicle: VehicleRecord) => void; onStartOCR: () => void; ocrValues: Record<string, unknown> | null; FieldComponent: VehicleProfileFieldComponent; SectionTitleComponent: VehicleProfileSectionTitleComponent }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<ProfileForm>(profileFromVehicle(vehicle))
  useEffect(() => {
    const base = profileFromVehicle(vehicle)
    const extracted = ocrValues
      ? Object.fromEntries(Object.entries(ocrValues).filter(([key]) => key in base)) as Partial<ProfileForm>
      : {}
    const next = { ...base, ...extracted }
    if (typeof extracted.make === "string") {
      next.make = normalizeVehicleManufacturer(extracted.make, next.equipmentType).name
    }
    if (typeof extracted.model === "string") next.model = formatVehicleModel(extracted.model)
    setForm(next)
  }, [vehicle, ocrValues])
  const profileVehicle = vehicle as VehicleProfileRecord
  const manufacturer = findVehicleManufacturer(vehicle.make, vehicle.equipmentType)
  if (!editing) return <div className="space-y-3">
    <Card>
      <SectionTitleComponent
        title="Vehicle Identity"
        description="Master record identifiers and registration details."
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onStartOCR}>
              <Upload className="mr-1.5 size-3.5" />Document / OCR
            </Button>
            <Button size="sm" onClick={() => setEditing(true)}>
              <Edit3 className="mr-1.5 size-3.5" />Edit
            </Button>
          </div>
        }
      />
      <div className="grid gap-3 p-4 sm:grid-cols-2 min-[1500px]:grid-cols-3">
        <ReadOnlyField label="Record ID" value={vehicle.id} />
        <ReadOnlyField label="Unit Number" value={vehicle.unitNumber} />
        <ReadOnlyField label="Vehicle Type" value={vehicle.equipmentType} />
        <ReadOnlyField label="Status" value={vehicle.status} />
        <ReadOnlyField label="VIN" value={vehicle.vin} />
        <ReadOnlyField label="Year" value={vehicle.year} />
        <ReadOnlyField label="Make" value={manufacturer?.code ? `${manufacturer.name} · ${manufacturer.code}` : vehicle.make} />
        <ReadOnlyField label="Model" value={formatVehicleModel(vehicle.model)} />
        <ReadOnlyField label="Color" value={vehicle.color} />
      </div>
    </Card>

    <Card>
      <SectionTitleComponent
        title="Operational Details"
        description="Fleet configuration, compliance program basis, and service dates."
      />
      <div className="grid gap-3 p-4 sm:grid-cols-2 min-[1500px]:grid-cols-3">
        <ReadOnlyField label="Operating Region" value={vehicle.operatingRegion} />
        <ReadOnlyField label="Axles" value={String(vehicle.axles ?? "—")} />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tare Weight</p>
          <p className="mt-1 text-lg font-bold tabular-nums">
            {vehicle.tareWeightKgs ?? "—"}
            <span className="ml-1 text-[10px] font-semibold text-muted-foreground">kg</span>
          </p>
        </div>
        <ReadOnlyField label="Fuel Type" value={vehicle.fuelType} />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Length</p>
          <p className="mt-1 text-lg font-bold tabular-nums">
            {vehicle.lengthFeet ?? "—"}
            <span className="ml-1 text-[10px] font-semibold text-muted-foreground">ft</span>
          </p>
        </div>
        <ReadOnlyField label="GPS Provider" value={vehicle.gpsProvider || "—"} />
        <ReadOnlyField label="Start Date" value={profileVehicle.fleetStartDate || "—"} />
        <ReadOnlyField label="End Date" value={profileVehicle.fleetEndDate || "—"} />
      </div>

    </Card>
  </div>

  return <Card><SectionTitleComponent title="Edit Vehicle Profile" description="Review extracted values before saving." /><div className="p-4"><VehicleProfileForm companyId={companyId} vehicle={vehicle} form={form} FieldComponent={FieldComponent} setForm={setForm} onCancel={() => { setEditing(false); setForm(profileFromVehicle(vehicle)) }} onSave={() => { onSave(buildVehicle(form, vehicle)); setEditing(false) }} onStartOCR={onStartOCR} /></div></Card>
}

function ManufacturerCombobox({
  equipmentType,
  value,
  onChange,
}: {
  equipmentType: EquipmentType
  value: string
  onChange: (value: string) => void
}) {
  const listId = useId()
  const options = manufacturersForEquipment(equipmentType)
  const match = findVehicleManufacturer(value, equipmentType)

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className={`${inputClass} pl-9`}
          list={listId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            const selected = findVehicleManufacturer(value, equipmentType)
            if (selected) onChange(selected.name)
          }}
          placeholder="Search official manufacturers…"
          autoComplete="off"
        />
        <datalist id={listId}>
          {options.map((manufacturer) => (
            <option
              key={`${manufacturer.category}-${manufacturer.name}`}
              value={manufacturer.name}
              label={manufacturer.isOther ? "Other / Unlisted" : manufacturer.code || manufacturer.name}
            />
          ))}
        </datalist>
      </div>
      <p className={`mt-1 text-[10px] ${value && !match ? "text-amber-700" : "text-muted-foreground"}`}>
        {!value
          ? `Search the official ${equipmentType.startsWith("Trailer") || equipmentType === "Converter Dolly" ? "trailer" : "truck/tractor"} list.`
          : match
            ? match.code
              ? `Official code: ${match.code}`
              : "Other / Unlisted — no official code assigned."
            : "Not found in the official list. Review the spelling before saving."}
      </p>
    </div>
  )
}

export function VehicleProfileForm({ companyId, vehicle, form, setForm, onCancel, onSave, onStartOCR, forceOCRPrompt = false, FieldComponent }: { companyId: string; vehicle: VehicleRecord | null; form: ProfileForm; setForm: Dispatch<SetStateAction<ProfileForm>>; onCancel: () => void; onSave: () => void; onStartOCR: () => void; forceOCRPrompt?: boolean; FieldComponent: VehicleProfileFieldComponent }) {
  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => setForm((current) => ({ ...current, [key]: value }))
  return <div className="space-y-4">
    <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3"><div><p className="text-xs font-bold">OCR-first source capture</p><p className="text-[11px] text-muted-foreground">Upload the source document, review extracted values, then save the structured Vehicle record.</p></div><Button variant="outline" size="sm" onClick={onStartOCR}><Upload className="mr-1.5 size-3.5" />Start with Document</Button></div>
    <div className="grid gap-3 sm:grid-cols-2 min-[1500px]:grid-cols-3">
      <FieldComponent label="Record ID"><Input className={inputClass} value={vehicle?.id || "Generated on save"} disabled /></FieldComponent>
      <FieldComponent label="Equipment Number" required><Input className={inputClass} value={form.unitNumber} onChange={(e) => set("unitNumber", e.target.value)} /></FieldComponent>
      <FieldComponent label="Vehicle Type" required><select className={selectClass} value={form.equipmentType} onChange={(e) => { const nextType = e.target.value as EquipmentType; setForm((current) => ({ ...current, equipmentType: nextType, make: findVehicleManufacturer(current.make, nextType)?.name || "" })) }}>{VEHICLE_TYPES.map((item) => <option key={item}>{item}</option>)}</select></FieldComponent>
      <FieldComponent label="Status"><select className={selectClass} value={form.status} onChange={(e) => set("status", e.target.value as VehicleStatus)}>{VEHICLE_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></FieldComponent>
      <FieldComponent label="VIN" required><Input className={inputClass} value={form.vin} onChange={(e) => set("vin", normalizeVIN(e.target.value))} maxLength={17} /></FieldComponent>
      <FieldComponent label="Year"><Input className={inputClass} value={form.year} onChange={(e) => set("year", e.target.value)} /></FieldComponent>
      <FieldComponent label="Make"><ManufacturerCombobox equipmentType={form.equipmentType} value={form.make} onChange={(value) => set("make", value)} /></FieldComponent>
      <FieldComponent label="Model"><Input className={inputClass} value={form.model} onChange={(e) => set("model", e.target.value)} /></FieldComponent>
      <FieldComponent label="Color"><Input className={inputClass} value={form.color} onChange={(e) => set("color", e.target.value)} /></FieldComponent>
      <FieldComponent label="Operating Region"><select className={selectClass} value={form.operatingRegion} onChange={(e) => set("operatingRegion", e.target.value as ProfileForm["operatingRegion"])}><option>Canada Only</option><option>US Only</option><option>Cross-Border</option></select></FieldComponent>
      <FieldComponent label="Equipment Axles"><Input className={inputClass} type="number" min="0" value={form.axles} onChange={(e) => set("axles", e.target.value)} /></FieldComponent>
      <FieldComponent label="Start Date"><Input className={inputClass} type="date" value={form.fleetStartDate} onChange={(e) => set("fleetStartDate", e.target.value)} /></FieldComponent>
      <FieldComponent label="End Date"><Input className={inputClass} type="date" value={form.fleetEndDate} onChange={(e) => set("fleetEndDate", e.target.value)} /></FieldComponent>
      <FieldComponent label="Tare Weight" className="md:col-span-2"><div className="flex items-center gap-2"><Input className={`${inputClass} text-base font-bold tabular-nums`} type="number" min="0" value={form.tareWeight} onChange={(e) => set("tareWeight", e.target.value)} /><select className="h-9 w-16 rounded-lg border border-input bg-background px-2 text-[10px] font-semibold" value={form.tareWeightUnit} onChange={(e) => set("tareWeightUnit", e.target.value as "kg" | "lb")}><option>kg</option><option>lb</option></select></div></FieldComponent>
      <FieldComponent label="Fuel Type"><select className={selectClass} value={form.fuelType} onChange={(e) => set("fuelType", e.target.value as ProfileForm["fuelType"])}><option>Diesel</option><option>Electric</option><option>Gasoline</option><option>CNG/LNG</option><option>None / Unpowered</option></select></FieldComponent>
      <FieldComponent label="Equipment Length" className="md:col-span-2"><div className="flex items-center gap-2"><Input className={`${inputClass} text-base font-bold tabular-nums`} type="number" min="0" value={form.equipmentLength} onChange={(e) => set("equipmentLength", e.target.value)} /><select className="h-9 w-16 rounded-lg border border-input bg-background px-2 text-[10px] font-semibold" value={form.equipmentLengthUnit} onChange={(e) => set("equipmentLengthUnit", e.target.value as "ft" | "m")}><option>ft</option><option>m</option></select></div></FieldComponent>
      <FieldComponent label="GPS Provider"><Input className={inputClass} value={form.gpsProvider} onChange={(e) => set("gpsProvider", e.target.value)} /></FieldComponent>
    </div>
    <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button onClick={onSave}>Save Vehicle</Button></div>
  </div>
}
