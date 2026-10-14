"use client"

import * as React from "react"
import { FileText, Link2, LockKeyhole, Snowflake, Thermometer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ISODateInput } from "@/src/components/shared/ISODateInput"

export const REEFER_OPERATIONAL_CHECK_COMPLIANCE_BASIS = [
  { authority: "FDA", reference: "21 CFR 1.908 — Sanitary transportation operations and temperature control", url: "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-1/subpart-O/subject-group-ECFRe79dfa68f350fd3/section-1.908" },
  { authority: "FDA", reference: "FSMA sanitary transportation guidance", url: "https://www.fda.gov/food/food-safety-modernization-act-fsma/frequently-asked-questions-fsma" },
  { authority: "CFIA", reference: "SFCR preventive controls — conveyance temperature, sanitation and recording instruments", url: "https://inspection.canada.ca/en/food-safety-industry/preventive-control-plans/regulatory-requirements" },
  { authority: "OEM", reference: "Thermo King operator pre-trip inspection guidance", url: "https://www.emea-user-manuals.thermoking.com/etech-emea-public/thermoking-emea/Galway%20-%20Trailer/Literature/Operation%20or%20Owners/10066-22.pdf" },
] as const

export type ReeferCheckStage = "BEFORE_LOADING" | "PRE_TRIP" | "IN_TRANSIT" | "AT_DELIVERY" | "POST_TRIP" | "MAINTENANCE_RELEASE"
export type ReeferCheckResult = "PASS" | "FAIL" | "CONDITIONAL"
export type ReeferItemResult = "PASS" | "FAIL" | "NOT_CHECKED" | "NOT_APPLICABLE"
export type TemperatureUnit = "C" | "F"
export type ReeferOperatingMode = "CONTINUOUS" | "START_STOP" | "DEFROST" | "OFF" | "OTHER"
export type LoadDecision = "ACCEPT_FOR_LOADING" | "HOLD_FOR_CORRECTION" | "DO_NOT_LOAD" | "CONTINUE_WITH_MONITORING" | "STOP_AND_ESCALATE"

export interface ReeferEquipmentOption {
  id: string
  unitNumber: string
  vin?: string
  equipmentType: string
  plate?: string
  reeferUnitId?: string
  reeferManufacturer?: string
  reeferModel?: string
  reeferSerialNumber?: string
}

export interface ReeferCheckEvidence {
  id: string
  fileName: string
  kind?: "EXTERNAL_REPORT" | "TEMPERATURE_LOG" | "PHOTO" | "CLEANING_RECORD" | "OTHER"
}

export interface ReeferZoneReading {
  id: string
  zoneLabel: string
  setpoint?: number
  supplyAir?: number
  returnAir?: number
  productTemperature?: number
}

export interface ReeferOperationalItem {
  id: string
  category: "UNIT" | "CONTROLLER" | "AIRFLOW" | "TEMPERATURE" | "SANITATION" | "CARGO_COMPARTMENT" | "DATA_LOGGER" | "OTHER"
  item: string
  result: ReeferItemResult
  observation?: string
  correctiveAction?: string
}

export interface ReeferUnitOperationalCheckRecordModel {
  id: string
  companyId: string
  equipmentId: string
  recordType: "REEFER_UNIT_OPERATIONAL_CHECK"
  stage: ReeferCheckStage
  checkedAt: string
  operator: { contactId: string; name: string; role?: string }
  equipment: {
    unitNumber: string
    vin?: string
    equipmentType: string
    plate?: string
    reeferUnitId?: string
    manufacturer?: string
    model?: string
    serialNumber?: string
    engineHours?: number
    fuelLevelPercent?: number
    powerSource?: "DIESEL" | "ELECTRIC_STANDBY" | "HYBRID" | "OTHER"
  }
  shipment: {
    loadReference?: string
    commodity?: string
    shipperTemperatureSpecificationReceived: boolean
    foodSafetyResponsibility?: "SHIPPER" | "LOADER" | "CARRIER" | "SHARED" | "NOT_APPLICABLE" | "UNKNOWN"
    temperatureUnit: TemperatureUnit
    minimumAllowed?: number
    maximumAllowed?: number
    preCoolingRequired: boolean
    preCoolingCompleted: boolean
    preCoolingTarget?: number
    preCoolingActual?: number
    cargoCompartmentClean: boolean
    priorLoadKnown: boolean
    priorLoadDescription?: string
    cleaningRecordReference?: string
  }
  controls: {
    operatingMode: ReeferOperatingMode
    setpoint?: number
    ambientTemperature?: number
    controllerDisplayTemperature?: number
    diagnosticPreTripResult: "PASS" | "FAIL" | "NOT_RUN"
    diagnosticTestCode?: string
    alarmCodes: string[]
    dataLoggerOperational: boolean
    temperatureRecorderOperational: boolean
    remoteMonitoringOperational?: boolean
    lastSensorCalibrationDate?: string
  }
  zones: ReeferZoneReading[]
  operationalItems: ReeferOperationalItem[]
  normalizedResult: ReeferCheckResult
  loadDecision: LoadDecision
  temperatureDeviation: boolean
  deviationExplanation?: string
  linkedRepairRecordIds: string[]
  sourceEvidenceIds: string[]
  evidenceMode: "ATTACHED_SOURCE" | "GENERATE_SIGNED_PDF_ON_SAVE"
  generatedPdfRequired: true
  recordState: "FINAL_LOCKED"
  notes?: string
  createdAt: string
  finalizedAt: string
}

const DEFAULT_ITEMS: Omit<ReeferOperationalItem, "id">[] = [
  { category: "UNIT", item: "Unit starts and runs without abnormal noise, smoke or vibration", result: "NOT_CHECKED" },
  { category: "UNIT", item: "Fuel, oil, coolant, belts, hoses, wiring and visible leaks", result: "NOT_CHECKED" },
  { category: "UNIT", item: "Panels, fasteners, guards and mounting condition", result: "NOT_CHECKED" },
  { category: "CONTROLLER", item: "Controller display, setpoint entry and operating mode", result: "NOT_CHECKED" },
  { category: "CONTROLLER", item: "Alarm history reviewed and active alarms addressed", result: "NOT_CHECKED" },
  { category: "AIRFLOW", item: "Condenser and evaporator airflow unobstructed", result: "NOT_CHECKED" },
  { category: "AIRFLOW", item: "Bulkhead, chute, floor channels and return-air path clear", result: "NOT_CHECKED" },
  { category: "CARGO_COMPARTMENT", item: "Doors, seals, walls, floor, ceiling and drains are serviceable", result: "NOT_CHECKED" },
  { category: "SANITATION", item: "Cargo compartment clean, dry, odor-free and free of contamination/pests", result: "NOT_CHECKED" },
  { category: "TEMPERATURE", item: "Unit reaches and maintains required setpoint", result: "NOT_CHECKED" },
  { category: "TEMPERATURE", item: "Defrost cycle operates when tested or required", result: "NOT_CHECKED" },
  { category: "DATA_LOGGER", item: "Temperature recorder/data logger has correct date/time and records data", result: "NOT_CHECKED" },
]

const inputClass = "h-10 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
const areaClass = "min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">{label}{required ? " *" : ""}</span>{children}</label>
}

function numberOrUndefined(value: string) {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function labelFor(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function validateReeferUnitOperationalCheck(record: ReeferUnitOperationalCheckRecordModel): string[] {
  const errors: string[] = []
  if (!record.equipmentId) errors.push("Reefer-equipped vehicle or trailer is required.")
  if (!record.checkedAt) errors.push("Check date and time are required.")
  if (!record.operator.name.trim()) errors.push("Person completing the check is required.")
  if (!record.operator.contactId.trim()) errors.push("Person completing the check must link to a Driver or Contact record.")
  if (!record.controls.operatingMode) errors.push("Operating mode is required.")
  if (record.stage === "BEFORE_LOADING" && record.shipment.preCoolingRequired && !record.shipment.preCoolingCompleted) errors.push("Required pre-cooling has not been completed.")
  if (record.shipment.preCoolingCompleted && record.shipment.preCoolingActual == null) errors.push("Record actual cargo-compartment temperature after pre-cooling.")
  if (record.shipment.shipperTemperatureSpecificationReceived && record.controls.setpoint == null) errors.push("Setpoint is required when a shipper temperature specification was received.")
  if (!record.zones.length) errors.push("At least one temperature zone or compartment reading is required.")
  if (record.zones.some((zone) => zone.supplyAir == null && zone.returnAir == null)) errors.push("Each zone needs a supply-air or return-air reading.")
  if (!record.operationalItems.some((item) => item.result !== "NOT_CHECKED")) errors.push("Complete the operational checklist.")
  if (record.normalizedResult === "PASS" && record.operationalItems.some((item) => item.result === "FAIL")) errors.push("A record with failed operational items cannot be marked Pass.")
  if (record.temperatureDeviation && !record.deviationExplanation?.trim()) errors.push("Explain the temperature deviation and action taken.")
  if (record.loadDecision === "ACCEPT_FOR_LOADING" && (record.normalizedResult !== "PASS" || record.temperatureDeviation)) errors.push("Accept for Loading requires a passed check with no unresolved temperature deviation.")
  if (record.evidenceMode === "ATTACHED_SOURCE" && !record.sourceEvidenceIds.length) errors.push("Attach source evidence or select Generate Signed PDF on Save.")
  return errors
}

type Props = {
  companyId: string
  equipment: ReeferEquipmentOption[]
  evidence: ReeferCheckEvidence[]
  operatorName?: string
  operatorContactId?: string
  operatorOptions?: { id: string; name: string }[]
  onSave: (record: ReeferUnitOperationalCheckRecordModel) => Promise<void>
}

export function ReeferUnitOperationalCheckRecord({ companyId, equipment, evidence, operatorName = "", operatorContactId = "", operatorOptions = [], onSave }: Props) {
  const [equipmentId, setEquipmentId] = React.useState(equipment[0]?.id || "")
  const [stage, setStage] = React.useState<ReeferCheckStage>("BEFORE_LOADING")
  const [checkedAt, setCheckedAt] = React.useState("")
  const [operator, setOperator] = React.useState(operatorName)
  const [operatorId, setOperatorId] = React.useState(operatorContactId)
  const [engineHours, setEngineHours] = React.useState("")
  const [fuelLevel, setFuelLevel] = React.useState("")
  const [powerSource, setPowerSource] = React.useState<"DIESEL" | "ELECTRIC_STANDBY" | "HYBRID" | "OTHER">("DIESEL")
  const [loadReference, setLoadReference] = React.useState("")
  const [commodity, setCommodity] = React.useState("")
  const [specReceived, setSpecReceived] = React.useState(false)
  const [responsibility, setResponsibility] = React.useState<"SHIPPER" | "LOADER" | "CARRIER" | "SHARED" | "NOT_APPLICABLE" | "UNKNOWN">("UNKNOWN")
  const [temperatureUnit, setTemperatureUnit] = React.useState<TemperatureUnit>("F")
  const [minimumAllowed, setMinimumAllowed] = React.useState("")
  const [maximumAllowed, setMaximumAllowed] = React.useState("")
  const [preCoolingRequired, setPreCoolingRequired] = React.useState(true)
  const [preCoolingCompleted, setPreCoolingCompleted] = React.useState(false)
  const [preCoolingTarget, setPreCoolingTarget] = React.useState("")
  const [preCoolingActual, setPreCoolingActual] = React.useState("")
  const [clean, setClean] = React.useState(false)
  const [priorLoadKnown, setPriorLoadKnown] = React.useState(false)
  const [priorLoad, setPriorLoad] = React.useState("")
  const [cleaningReference, setCleaningReference] = React.useState("")
  const [operatingMode, setOperatingMode] = React.useState<ReeferOperatingMode>("CONTINUOUS")
  const [setpoint, setSetpoint] = React.useState("")
  const [ambient, setAmbient] = React.useState("")
  const [displayTemperature, setDisplayTemperature] = React.useState("")
  const [diagnostic, setDiagnostic] = React.useState<"PASS" | "FAIL" | "NOT_RUN">("NOT_RUN")
  const [diagnosticCode, setDiagnosticCode] = React.useState("")
  const [alarmCodes, setAlarmCodes] = React.useState("")
  const [dataLogger, setDataLogger] = React.useState(false)
  const [temperatureRecorder, setTemperatureRecorder] = React.useState(false)
  const [remoteMonitoring, setRemoteMonitoring] = React.useState(false)
  const [lastCalibrationDate, setLastCalibrationDate] = React.useState("")
  const [zones, setZones] = React.useState<ReeferZoneReading[]>([{ id: "zone-main", zoneLabel: "Main compartment" }])
  const [items, setItems] = React.useState<ReeferOperationalItem[]>(DEFAULT_ITEMS.map((item, index) => ({ ...item, id: `reefer-check-${index + 1}` })))
  const [result, setResult] = React.useState<ReeferCheckResult>("PASS")
  const [loadDecision, setLoadDecision] = React.useState<LoadDecision>("HOLD_FOR_CORRECTION")
  const [deviation, setDeviation] = React.useState(false)
  const [deviationExplanation, setDeviationExplanation] = React.useState("")
  const [repairIds, setRepairIds] = React.useState("")
  const [evidenceMode, setEvidenceMode] = React.useState<"ATTACHED_SOURCE" | "GENERATE_SIGNED_PDF_ON_SAVE">("GENERATE_SIGNED_PDF_ON_SAVE")
  const [notes, setNotes] = React.useState("")
  const [errors, setErrors] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const [sideTab, setSideTab] = React.useState<"EVIDENCE" | "DETAILS" | "ACTIVITY">("EVIDENCE")

  const selected = equipment.find((item) => item.id === equipmentId)
  const failedItems = items.filter((item) => item.result === "FAIL").length

  function updateZone(id: string, patch: Partial<ReeferZoneReading>) {
    setZones((current) => current.map((zone) => zone.id === id ? { ...zone, ...patch } : zone))
  }

  function updateItem(id: string, patch: Partial<ReeferOperationalItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  async function save() {
    if (!selected) return setErrors(["Select reefer equipment."])
    const now = new Date().toISOString()
    const record: ReeferUnitOperationalCheckRecordModel = {
      id: crypto.randomUUID(), companyId, equipmentId: selected.id, recordType: "REEFER_UNIT_OPERATIONAL_CHECK",
      stage, checkedAt, operator: { contactId: operatorId.trim(), name: operator.trim() },
      equipment: {
        unitNumber: selected.unitNumber, vin: selected.vin, equipmentType: selected.equipmentType, plate: selected.plate,
        reeferUnitId: selected.reeferUnitId, manufacturer: selected.reeferManufacturer, model: selected.reeferModel,
        serialNumber: selected.reeferSerialNumber, engineHours: numberOrUndefined(engineHours),
        fuelLevelPercent: numberOrUndefined(fuelLevel), powerSource,
      },
      shipment: {
        loadReference: loadReference.trim() || undefined, commodity: commodity.trim() || undefined,
        shipperTemperatureSpecificationReceived: specReceived, foodSafetyResponsibility: responsibility,
        temperatureUnit, minimumAllowed: numberOrUndefined(minimumAllowed), maximumAllowed: numberOrUndefined(maximumAllowed),
        preCoolingRequired, preCoolingCompleted, preCoolingTarget: numberOrUndefined(preCoolingTarget),
        preCoolingActual: numberOrUndefined(preCoolingActual), cargoCompartmentClean: clean,
        priorLoadKnown, priorLoadDescription: priorLoad.trim() || undefined, cleaningRecordReference: cleaningReference.trim() || undefined,
      },
      controls: {
        operatingMode, setpoint: numberOrUndefined(setpoint), ambientTemperature: numberOrUndefined(ambient),
        controllerDisplayTemperature: numberOrUndefined(displayTemperature), diagnosticPreTripResult: diagnostic,
        diagnosticTestCode: diagnosticCode.trim() || undefined,
        alarmCodes: alarmCodes.split(",").map((value) => value.trim()).filter(Boolean),
        dataLoggerOperational: dataLogger, temperatureRecorderOperational: temperatureRecorder,
        remoteMonitoringOperational: remoteMonitoring, lastSensorCalibrationDate: lastCalibrationDate || undefined,
      },
      zones, operationalItems: items, normalizedResult: result, loadDecision,
      temperatureDeviation: deviation, deviationExplanation: deviationExplanation.trim() || undefined,
      linkedRepairRecordIds: repairIds.split(",").map((value) => value.trim()).filter(Boolean),
      sourceEvidenceIds: evidence.map((item) => item.id), evidenceMode, generatedPdfRequired: true,
      recordState: "FINAL_LOCKED", notes: notes.trim() || undefined, createdAt: now, finalizedAt: now,
    }
    const validation = validateReeferUnitOperationalCheck(record)
    if (validation.length) return setErrors(validation)
    setSaving(true); setErrors([])
    try { await onSave(record) }
    catch (cause) { setErrors([cause instanceof Error ? cause.message : "Reefer operational check could not be saved."]) }
    finally { setSaving(false) }
  }

  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
    <main className="space-y-4">
      <Card className="p-4"><div className="mb-4 flex items-start justify-between"><div><h2 className="flex items-center gap-2 text-sm font-bold"><Snowflake className="size-4 text-primary" />Reefer Unit Operational Check</h2><p className="mt-1 text-xs text-muted-foreground">Operational readiness, temperature-control capability and cargo-compartment condition.</p></div><span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary"><LockKeyhole className="size-3" />Signed PDF on save</span></div>
        {errors.length ? <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive"><ul className="list-disc space-y-1 pl-4">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Reefer-equipped unit" required><select className={inputClass} value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>{equipment.map((item) => <option key={item.id} value={item.id}>Unit {item.unitNumber} · {item.equipmentType}</option>)}</select></Field>
          <Field label="Check stage" required><select className={inputClass} value={stage} onChange={(e) => setStage(e.target.value as ReeferCheckStage)}>{["BEFORE_LOADING","PRE_TRIP","IN_TRANSIT","AT_DELIVERY","POST_TRIP","MAINTENANCE_RELEASE"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></Field>
          <Field label="Check date/time" required><Input className={inputClass} type="datetime-local" value={checkedAt} onChange={(e) => setCheckedAt(e.target.value)} /></Field>
          <Field label="Completed by" required><Input className={inputClass} value={operator} onChange={(e) => setOperator(e.target.value)} /></Field>
          <Field label="Linked driver / contact" required>{operatorOptions.length ? <select className={inputClass} value={operatorId} onChange={(e) => { const option = operatorOptions.find((item) => item.id === e.target.value); setOperatorId(e.target.value); if (option) setOperator(option.name) }}><option value="">Select driver or contact</option>{operatorOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <Input className={inputClass} placeholder="Driver or Contact record ID" value={operatorId} onChange={(e) => setOperatorId(e.target.value)} />}</Field>
          <Field label="Reefer engine hours"><Input className={inputClass} inputMode="decimal" value={engineHours} onChange={(e) => setEngineHours(e.target.value)} /></Field>
          <Field label="Fuel level %"><Input className={inputClass} inputMode="decimal" value={fuelLevel} onChange={(e) => setFuelLevel(e.target.value)} /></Field>
          <Field label="Power source"><select className={inputClass} value={powerSource} onChange={(e) => setPowerSource(e.target.value as typeof powerSource)}>{["DIESEL","ELECTRIC_STANDBY","HYBRID","OTHER"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></Field>
          <Field label="Load / shipment reference"><Input className={inputClass} value={loadReference} onChange={(e) => setLoadReference(e.target.value)} /></Field>
          <Field label="Commodity"><Input className={inputClass} value={commodity} onChange={(e) => setCommodity(e.target.value)} /></Field>
        </div>
      </Card>

      <Card className="p-4"><h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Cargo-temperature requirement and sanitation</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Shipper temperature specification"><select className={inputClass} value={specReceived ? "RECEIVED" : "NOT_RECEIVED"} onChange={(e) => setSpecReceived(e.target.value === "RECEIVED")}><option value="NOT_RECEIVED">Not received</option><option value="RECEIVED">Received in writing</option></select></Field>
        <Field label="Temperature responsibility"><select className={inputClass} value={responsibility} onChange={(e) => setResponsibility(e.target.value as typeof responsibility)}>{["SHIPPER","LOADER","CARRIER","SHARED","NOT_APPLICABLE","UNKNOWN"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></Field>
        <Field label="Temperature unit"><select className={inputClass} value={temperatureUnit} onChange={(e) => setTemperatureUnit(e.target.value as TemperatureUnit)}><option value="F">°F</option><option value="C">°C</option></select></Field>
        <Field label="Minimum allowed"><Input className={inputClass} inputMode="decimal" value={minimumAllowed} onChange={(e) => setMinimumAllowed(e.target.value)} /></Field>
        <Field label="Maximum allowed"><Input className={inputClass} inputMode="decimal" value={maximumAllowed} onChange={(e) => setMaximumAllowed(e.target.value)} /></Field>
        <Field label="Pre-cooling required"><select className={inputClass} value={preCoolingRequired ? "YES" : "NO"} onChange={(e) => setPreCoolingRequired(e.target.value === "YES")}><option value="YES">Yes</option><option value="NO">No</option></select></Field>
        <Field label="Pre-cooling completed"><select className={inputClass} value={preCoolingCompleted ? "YES" : "NO"} onChange={(e) => setPreCoolingCompleted(e.target.value === "YES")}><option value="NO">No</option><option value="YES">Yes</option></select></Field>
        <Field label="Pre-cooling target"><Input className={inputClass} inputMode="decimal" value={preCoolingTarget} onChange={(e) => setPreCoolingTarget(e.target.value)} /></Field>
        <Field label="Actual compartment temperature"><Input className={inputClass} inputMode="decimal" value={preCoolingActual} onChange={(e) => setPreCoolingActual(e.target.value)} /></Field>
        <Field label="Cargo compartment clean"><select className={inputClass} value={clean ? "YES" : "NO"} onChange={(e) => setClean(e.target.value === "YES")}><option value="NO">No / not verified</option><option value="YES">Yes</option></select></Field>
        <Field label="Prior load known"><select className={inputClass} value={priorLoadKnown ? "YES" : "NO"} onChange={(e) => setPriorLoadKnown(e.target.value === "YES")}><option value="NO">No</option><option value="YES">Yes</option></select></Field>
        <Field label="Prior load"><Input className={inputClass} value={priorLoad} onChange={(e) => setPriorLoad(e.target.value)} /></Field>
        <Field label="Cleaning record reference"><Input className={inputClass} value={cleaningReference} onChange={(e) => setCleaningReference(e.target.value)} /></Field>
      </div></Card>

      <Card className="p-4"><h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Controller, diagnostics and monitoring</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Operating mode" required><select className={inputClass} value={operatingMode} onChange={(e) => setOperatingMode(e.target.value as ReeferOperatingMode)}>{["CONTINUOUS","START_STOP","DEFROST","OFF","OTHER"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></Field>
        <Field label={`Setpoint °${temperatureUnit}`}><Input className={inputClass} inputMode="decimal" value={setpoint} onChange={(e) => setSetpoint(e.target.value)} /></Field>
        <Field label={`Controller display °${temperatureUnit}`}><Input className={inputClass} inputMode="decimal" value={displayTemperature} onChange={(e) => setDisplayTemperature(e.target.value)} /></Field>
        <Field label={`Ambient °${temperatureUnit}`}><Input className={inputClass} inputMode="decimal" value={ambient} onChange={(e) => setAmbient(e.target.value)} /></Field>
        <Field label="Diagnostic pre-trip"><select className={inputClass} value={diagnostic} onChange={(e) => setDiagnostic(e.target.value as typeof diagnostic)}><option>NOT_RUN</option><option>PASS</option><option>FAIL</option></select></Field>
        <Field label="Diagnostic test code"><Input className={inputClass} value={diagnosticCode} onChange={(e) => setDiagnosticCode(e.target.value)} /></Field>
        <Field label="Alarm codes"><Input className={inputClass} placeholder="Comma separated" value={alarmCodes} onChange={(e) => setAlarmCodes(e.target.value)} /></Field>
        <Field label="Data logger"><select className={inputClass} value={dataLogger ? "OPERATIONAL" : "NOT_VERIFIED"} onChange={(e) => setDataLogger(e.target.value === "OPERATIONAL")}><option value="NOT_VERIFIED">Not verified</option><option value="OPERATIONAL">Operational</option></select></Field>
        <Field label="Temperature recorder"><select className={inputClass} value={temperatureRecorder ? "OPERATIONAL" : "NOT_VERIFIED"} onChange={(e) => setTemperatureRecorder(e.target.value === "OPERATIONAL")}><option value="NOT_VERIFIED">Not verified</option><option value="OPERATIONAL">Operational</option></select></Field>
        <Field label="Remote monitoring"><select className={inputClass} value={remoteMonitoring ? "OPERATIONAL" : "NOT_VERIFIED"} onChange={(e) => setRemoteMonitoring(e.target.value === "OPERATIONAL")}><option value="NOT_VERIFIED">Not verified / unavailable</option><option value="OPERATIONAL">Operational</option></select></Field>
        <Field label="Last sensor calibration"><ISODateInput className={inputClass} value={lastCalibrationDate} onValueChange={setLastCalibrationDate} /></Field>
      </div></Card>

      <Card className="p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold">Temperature zones</h3><p className="mt-1 text-[11px] text-muted-foreground">Record multi-zone readings separately; never average away a warm compartment.</p></div><Button variant="outline" size="sm" onClick={() => setZones((current) => [...current, { id: crypto.randomUUID(), zoneLabel: `Zone ${current.length + 1}` }])}>Add zone</Button></div><div className="space-y-2">{zones.map((zone) => <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-6" key={zone.id}>
        <Input value={zone.zoneLabel} onChange={(e) => updateZone(zone.id, { zoneLabel: e.target.value })} />
        <Input inputMode="decimal" placeholder="Setpoint" value={zone.setpoint ?? ""} onChange={(e) => updateZone(zone.id, { setpoint: numberOrUndefined(e.target.value) })} />
        <Input inputMode="decimal" placeholder="Supply air" value={zone.supplyAir ?? ""} onChange={(e) => updateZone(zone.id, { supplyAir: numberOrUndefined(e.target.value) })} />
        <Input inputMode="decimal" placeholder="Return air" value={zone.returnAir ?? ""} onChange={(e) => updateZone(zone.id, { returnAir: numberOrUndefined(e.target.value) })} />
        <Input inputMode="decimal" placeholder="Product temp" value={zone.productTemperature ?? ""} onChange={(e) => updateZone(zone.id, { productTemperature: numberOrUndefined(e.target.value) })} />
        <Button variant="ghost" size="sm" disabled={zones.length === 1} onClick={() => setZones((current) => current.filter((item) => item.id !== zone.id))}>Remove</Button>
      </div>)}</div></Card>

      <Card className="p-4"><h3 className="mb-3 text-sm font-bold">Operational checklist</h3><div className="space-y-2">{items.map((item) => <div className="grid gap-2 rounded-lg border p-3 lg:grid-cols-[130px_1fr_150px]" key={item.id}><span className="text-[10px] font-bold text-muted-foreground">{labelFor(item.category)}</span><div><p className="text-xs font-semibold">{item.item}</p><Input className="mt-2" placeholder="Observation / corrective action" value={item.observation || ""} onChange={(e) => updateItem(item.id, { observation: e.target.value })} /></div><select className={inputClass} value={item.result} onChange={(e) => updateItem(item.id, { result: e.target.value as ReeferItemResult })}>{["PASS","FAIL","NOT_CHECKED","NOT_APPLICABLE"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></div>)}</div></Card>

      <Card className="p-4"><h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Decision and evidence</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Overall result" required><select className={inputClass} value={result} onChange={(e) => setResult(e.target.value as ReeferCheckResult)}><option>PASS</option><option>CONDITIONAL</option><option>FAIL</option></select></Field>
        <Field label="Load / movement decision" required><select className={inputClass} value={loadDecision} onChange={(e) => setLoadDecision(e.target.value as LoadDecision)}>{["ACCEPT_FOR_LOADING","HOLD_FOR_CORRECTION","DO_NOT_LOAD","CONTINUE_WITH_MONITORING","STOP_AND_ESCALATE"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></Field>
        <Field label="Temperature deviation"><select className={inputClass} value={deviation ? "YES" : "NO"} onChange={(e) => setDeviation(e.target.value === "YES")}><option value="NO">No</option><option value="YES">Yes</option></select></Field>
        <Field label="Evidence method"><select className={inputClass} value={evidenceMode} onChange={(e) => setEvidenceMode(e.target.value as typeof evidenceMode)}><option value="GENERATE_SIGNED_PDF_ON_SAVE">Generate signed PDF on save</option><option value="ATTACHED_SOURCE">Use attached source report</option></select></Field>
        <Field label="Linked Repair Record IDs"><Input className={inputClass} placeholder="Comma separated" value={repairIds} onChange={(e) => setRepairIds(e.target.value)} /></Field>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Deviation explanation / action"><Textarea className={areaClass} value={deviationExplanation} onChange={(e) => setDeviationExplanation(e.target.value)} /></Field></div>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Notes"><Textarea className={areaClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      </div><div className="mt-4 flex justify-end"><Button disabled={saving} onClick={save}>{saving ? "Finalizing…" : "Finalize Reefer Check"}</Button></div></Card>
    </main>

    <aside className="xl:sticky xl:top-4 xl:self-start"><Card className="overflow-hidden"><div className="grid grid-cols-3 border-b">{(["EVIDENCE","DETAILS","ACTIVITY"] as const).map((tab) => <button className={`px-2 py-3 text-[10px] font-bold ${sideTab === tab ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`} key={tab} onClick={() => setSideTab(tab)}>{tab}</button>)}</div><div className="p-4">
      {sideTab === "EVIDENCE" ? <div className="space-y-3"><div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><FileText className="mb-2 size-5 text-primary" /><p className="text-xs font-bold">{evidenceMode === "GENERATE_SIGNED_PDF_ON_SAVE" ? "TES signed PDF will become primary evidence" : `${evidence.length} source file${evidence.length === 1 ? "" : "s"} attached`}</p><p className="mt-1 text-[11px] text-muted-foreground">The finalized record is view-only. Corrections require a superseding record.</p></div>{evidence.map((item) => <div className="flex gap-2 rounded-lg border p-2 text-xs" key={item.id}><FileText className="size-4 text-primary" /><span><b className="block">{item.kind || "EVIDENCE"}</b>{item.fileName}</span></div>)}</div> : null}
      {sideTab === "DETAILS" ? <dl className="space-y-3 text-xs"><div><dt className="text-muted-foreground">Equipment</dt><dd className="font-bold">{selected ? `Unit ${selected.unitNumber}` : "Not selected"}</dd></div><div><dt className="text-muted-foreground">Temperature</dt><dd className="flex items-center gap-1 font-bold"><Thermometer className="size-3" />{setpoint || "—"} °{temperatureUnit}</dd></div><div><dt className="text-muted-foreground">Failed checks</dt><dd className={failedItems ? "font-bold text-destructive" : "font-bold text-emerald-700"}>{failedItems}</dd></div><div><dt className="text-muted-foreground">Permanent links</dt><dd className="mt-1 flex items-center gap-1 font-bold text-primary"><Link2 className="size-3" />Equipment · Shipment · Repairs</dd></div></dl> : null}
      {sideTab === "ACTIVITY" ? <div className="space-y-3 text-xs"><div className="flex gap-2"><Snowflake className="size-4 text-primary" /><div><p className="font-bold">Operational check opened</p><p className="text-muted-foreground">Awaiting completion and signature.</p></div></div><p className="rounded-lg bg-muted p-3 text-[11px] text-muted-foreground">The save handler must generate the PDF, attach its evidence ID, and write the audit event in the same transaction.</p></div> : null}
    </div></Card></aside>
  </div>
}
