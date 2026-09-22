"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, FileText, Gauge, Link2, LockKeyhole, ShieldCheck, Truck } from "lucide-react"
import {
  opacityLimitUtilization,
  resolveEmissionPlateLink,
  validateEmissionTestRecord,
  type EmissionProgramLayout,
  type EmissionRequirementTrigger,
  type EmissionTestMethod,
  type EmissionTestResult,
  type RegistrationForEmissionLink,
  type VehicleEmissionTestRecord,
} from "./emission-test-schema"

type VehicleOption = {
  id: string
  unitNumber: string
  vin: string
  year?: number
  make?: string
  model?: string
  registrations: RegistrationForEmissionLink[]
}

type Props = {
  companyId: string
  vehicles: VehicleOption[]
  evidence: { id: string; fileName: string } | null
  onSave: (record: VehicleEmissionTestRecord) => Promise<void>
}

const inputClass = "h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
const textareaClass = "min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">{label}{required ? " *" : ""}</span>{children}</label>
}

function numberOrUndefined(value: string) {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function EmissionTestRecordForm({ companyId, vehicles, evidence, onSave }: Props) {
  const [vehicleId, setVehicleId] = React.useState(vehicles[0]?.id || "")
  const [testedAt, setTestedAt] = React.useState("")
  const [jurisdiction, setJurisdiction] = React.useState("ON")
  const [programName, setProgramName] = React.useState("Ontario DriveON")
  const [layout, setLayout] = React.useState<EmissionProgramLayout>("ONTARIO_DRIVEON_CURRENT")
  const [trigger, setTrigger] = React.useState<EmissionRequirementTrigger>("REGISTRATION_RENEWAL")
  const [method, setMethod] = React.useState<EmissionTestMethod>("SNAP_ACCELERATION_OPACITY")
  const [normalizedResult, setNormalizedResult] = React.useState<EmissionTestResult>("PASS")
  const [sourceResult, setSourceResult] = React.useState("PASS")
  const [expiryDate, setExpiryDate] = React.useState("")
  const [inspectionId, setInspectionId] = React.useState("")
  const [certificateNumber, setCertificateNumber] = React.useState("")
  const [reportNumber, setReportNumber] = React.useState("")
  const [verificationCode, setVerificationCode] = React.useState("")
  const [sourcePlate, setSourcePlate] = React.useState("")
  const [sourcePlateJurisdiction, setSourcePlateJurisdiction] = React.useState("")
  const [sourceFleetId, setSourceFleetId] = React.useState("")
  const [odometer, setOdometer] = React.useState("")
  const [gvwrKg, setGvwrKg] = React.useState("")
  const [engineYear, setEngineYear] = React.useState("")
  const [engineMake, setEngineMake] = React.useState("")
  const [engineModel, setEngineModel] = React.useState("")
  const [engineSize, setEngineSize] = React.useState("")
  const [opacityReadings, setOpacityReadings] = React.useState("0.1, 0.2, 0.1")
  const [rpmReadings, setRpmReadings] = React.useState("1961, 1941, 1951")
  const [opacityResult, setOpacityResult] = React.useState("0.1")
  const [opacityLimit, setOpacityLimit] = React.useState("10")
  const [zeroDriftResult, setZeroDriftResult] = React.useState("0.1")
  const [zeroDriftLimit, setZeroDriftLimit] = React.useState("2")
  const [snapSpreadResult, setSnapSpreadResult] = React.useState("0")
  const [snapSpreadLimit, setSnapSpreadLimit] = React.useState("5")
  const [facilityNumber, setFacilityNumber] = React.useState("")
  const [facilityName, setFacilityName] = React.useState("")
  const [facilityAddress, setFacilityAddress] = React.useState("")
  const [facilityPhone, setFacilityPhone] = React.useState("")
  const [technicianNumber, setTechnicianNumber] = React.useState("")
  const [technicianName, setTechnicianName] = React.useState("")
  const [deviceId, setDeviceId] = React.useState("")
  const [softwareVersion, setSoftwareVersion] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [errors, setErrors] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)

  const vehicle = vehicles.find((item) => item.id === vehicleId)
  const registration = React.useMemo(() => resolveEmissionPlateLink({
    vehicleId,
    testedAt,
    sourcePlate,
    sourcePlateJurisdiction,
    registrations: vehicle?.registrations || [],
  }), [vehicle, vehicleId, testedAt, sourcePlate, sourcePlateJurisdiction])

  const utilization = opacityLimitUtilization(numberOrUndefined(opacityResult), numberOrUndefined(opacityLimit))
  const mismatch = registration.plateMatchStatus === "MISMATCH_REVIEW_REQUIRED"

  async function save() {
    if (!vehicle) return setErrors(["Select a vehicle."])
    const record: VehicleEmissionTestRecord = {
      id: crypto.randomUUID(), companyId, vehicleId: vehicle.id, recordType: "EMISSION_TEST",
      jurisdiction, programName, documentLayoutVersion: layout, requirementTrigger: trigger,
      testMethods: [method], inspectionId: inspectionId || undefined,
      certificateNumber: certificateNumber || undefined, reportNumber: reportNumber || undefined,
      verificationCode: verificationCode || undefined, testedAt, expiryDate: expiryDate || undefined,
      sourceResult, normalizedResult,
      vehicle: {
        unitNumber: vehicle.unitNumber, vin: vehicle.vin, sourceFleetId: sourceFleetId || undefined,
        sourcePlate: sourcePlate || undefined, sourcePlateJurisdiction: sourcePlateJurisdiction || undefined,
        gvwrKg: numberOrUndefined(gvwrKg), odometer: numberOrUndefined(odometer), odometerUnit: "KM",
        chassisYear: vehicle.year, chassisMake: vehicle.make, chassisModel: vehicle.model,
        engineYear: numberOrUndefined(engineYear), engineMake: engineMake || undefined,
        engineModel: engineModel || undefined, engineDisplacementLitres: numberOrUndefined(engineSize),
      },
      registration,
      opacity: method.includes("OPACITY") || method === "COMBINED_METHOD" ? {
        readings: opacityReadings.split(",").map(Number).filter(Number.isFinite),
        rpmReadings: rpmReadings.split(",").map((value) => numberOrUndefined(value.trim()) ?? null),
        result: numberOrUndefined(opacityResult), limit: numberOrUndefined(opacityLimit),
        zeroDriftStatus: "VALID", zeroDriftResult: numberOrUndefined(zeroDriftResult), zeroDriftLimit: numberOrUndefined(zeroDriftLimit),
        snapSpreadStatus: "VALID", snapSpreadResult: numberOrUndefined(snapSpreadResult), snapSpreadLimit: numberOrUndefined(snapSpreadLimit),
      } : undefined,
      facility: {
        facilityNumber: facilityNumber || undefined, name: facilityName || undefined,
        address: facilityAddress || undefined, phone: facilityPhone || undefined,
        technicianNumber: technicianNumber || undefined, technicianName: technicianName || undefined,
        technicianSignaturePresent: true, deviceId: deviceId || undefined,
        deviceType: layout === "ONTARIO_DRIVE_CLEAN_LEGACY" ? "ANALYZER" : "TABLET",
        softwareVersion: softwareVersion || undefined,
      },
      evidenceIds: evidence ? [evidence.id] : [], evidenceCompleteness: evidence ? "COMPLETE" : "MISSING",
      notes: notes || undefined, createdAt: new Date().toISOString(),
    }
    const validation = validateEmissionTestRecord(record)
    if (validation.length) return setErrors(validation)
    setSaving(true); setErrors([])
    try { await onSave(record) }
    catch (cause) { setErrors([cause instanceof Error ? cause.message : "Emission Test could not be saved."]) }
    finally { setSaving(false) }
  }

  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-sm font-bold">Emission Test</h2><p className="mt-1 text-xs text-muted-foreground">Internal certificate review before canonical save</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold">Draft</span></div>
        {errors.length ? <div role="alert" className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive"><ul className="list-disc space-y-1 pl-4">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Vehicle" required><select className={inputClass} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>{vehicles.map((item) => <option key={item.id} value={item.id}>Unit {item.unitNumber} · {item.vin}</option>)}</select></Field>
          <Field label="Test date and time" required><input className={inputClass} type="datetime-local" value={testedAt} onChange={(e) => setTestedAt(e.target.value)} /></Field>
          <Field label="Expiry date"><input className={inputClass} type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></Field>
          <Field label="Jurisdiction" required><input className={inputClass} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} /></Field>
          <Field label="Program" required><input className={inputClass} value={programName} onChange={(e) => setProgramName(e.target.value)} /></Field>
          <Field label="Requirement trigger"><select className={inputClass} value={trigger} onChange={(e) => setTrigger(e.target.value as EmissionRequirementTrigger)}>{["INITIAL_REGISTRATION","OWNERSHIP_TRANSFER","REGISTRATION_RENEWAL","PERIODIC_INSPECTION","ROADSIDE_ENFORCEMENT","RETEST","OTHER"].map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Certificate layout"><select className={inputClass} value={layout} onChange={(e) => setLayout(e.target.value as EmissionProgramLayout)}>{["ONTARIO_DRIVEON_CURRENT","ONTARIO_DRIVE_CLEAN_LEGACY","US_STATE_OPACITY","US_STATE_OBD","OTHER","UNKNOWN"].map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Test method"><select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as EmissionTestMethod)}>{["SNAP_ACCELERATION_OPACITY","ROLLING_ACCELERATION_OPACITY","STALL_ACCELERATION_OPACITY","OBD","OBD_II","VISUAL_EMISSION_CONTROL","ROADSIDE_SMOKE_OPACITY","COMBINED_METHOD","OTHER"].map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Result"><select className={inputClass} value={normalizedResult} onChange={(e) => setNormalizedResult(e.target.value as EmissionTestResult)}>{["PASS","FAIL","INVALID","UNKNOWN"].map((value) => <option key={value}>{value}</option>)}</select></Field>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4"><h3 className="mb-3 flex items-center gap-2 text-xs font-bold"><Truck className="size-4 text-primary" />Vehicle and registration identity</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="VIN"><input className={inputClass} value={vehicle?.vin || ""} readOnly /></Field>
        <Field label="Source Fleet ID"><input className={inputClass} value={sourceFleetId} onChange={(e) => setSourceFleetId(e.target.value)} /></Field>
        <Field label="Odometer (km)"><input className={inputClass} inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} /></Field>
        <Field label="Certificate plate"><input className={inputClass} value={sourcePlate} onChange={(e) => setSourcePlate(e.target.value)} placeholder="May be blank" /></Field>
        <Field label="Certificate plate jurisdiction"><input className={inputClass} value={sourcePlateJurisdiction} onChange={(e) => setSourcePlateJurisdiction(e.target.value)} /></Field>
        <Field label="GVWR (kg)"><input className={inputClass} inputMode="numeric" value={gvwrKg} onChange={(e) => setGvwrKg(e.target.value)} /></Field>
      </div>
      <div className={`mt-3 rounded-lg border p-3 ${mismatch ? "border-destructive/30 bg-destructive/5" : "border-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-950/20"}`}>
        <div className="flex items-start gap-2">{mismatch ? <AlertTriangle className="mt-0.5 size-4 text-destructive" /> : <Link2 className="mt-0.5 size-4 text-emerald-700" />}<div><p className="text-xs font-bold">{mismatch ? "Registration conflict — review required" : registration.registrationRecordId ? "Plate linked to vehicle registration" : "No plate registration effective on test date"}</p><p className="mt-1 text-[11px] text-muted-foreground">{registration.registrationRecordId ? `${registration.plate} ${registration.jurisdiction} · Registration ${registration.registrationRecordId}` : "VIN remains the primary vehicle identifier. A plate is not required before first registration."}</p></div></div>
      </div></section>

      <section className="rounded-xl border border-border bg-card p-4"><h3 className="mb-3 flex items-center gap-2 text-xs font-bold"><Gauge className="size-4 text-primary" />Emission measurements</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Opacity readings"><input className={inputClass} value={opacityReadings} onChange={(e) => setOpacityReadings(e.target.value)} /></Field><Field label="RPM readings"><input className={inputClass} value={rpmReadings} onChange={(e) => setRpmReadings(e.target.value)} /></Field><Field label="Opacity result %"><input className={inputClass} value={opacityResult} onChange={(e) => setOpacityResult(e.target.value)} /></Field><Field label="Applicable limit %"><input className={inputClass} value={opacityLimit} onChange={(e) => setOpacityLimit(e.target.value)} /></Field><Field label="Zero drift result %"><input className={inputClass} value={zeroDriftResult} onChange={(e) => setZeroDriftResult(e.target.value)} /></Field><Field label="Zero drift limit %"><input className={inputClass} value={zeroDriftLimit} onChange={(e) => setZeroDriftLimit(e.target.value)} /></Field><Field label="Snap spread result %"><input className={inputClass} value={snapSpreadResult} onChange={(e) => setSnapSpreadResult(e.target.value)} /></Field><Field label="Snap spread limit %"><input className={inputClass} value={snapSpreadLimit} onChange={(e) => setSnapSpreadLimit(e.target.value)} /></Field>
      </div><div className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs"><span className="text-muted-foreground">Limit utilization</span><strong className="ml-2">{utilization == null ? "—" : `${utilization}%`}</strong></div></section>

      <section className="rounded-xl border border-border bg-card p-4"><h3 className="mb-3 text-xs font-bold">Certificate and facility details</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="Inspection ID"><input className={inputClass} value={inspectionId} onChange={(e) => setInspectionId(e.target.value)} /></Field><Field label="Certificate number"><input className={inputClass} value={certificateNumber} onChange={(e) => setCertificateNumber(e.target.value)} /></Field><Field label="Report number"><input className={inputClass} value={reportNumber} onChange={(e) => setReportNumber(e.target.value)} /></Field><Field label="Verification/QR code"><input className={inputClass} value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} /></Field><Field label="Source result"><input className={inputClass} value={sourceResult} onChange={(e) => setSourceResult(e.target.value)} /></Field><Field label="Facility number"><input className={inputClass} value={facilityNumber} onChange={(e) => setFacilityNumber(e.target.value)} /></Field><Field label="Facility name"><input className={inputClass} value={facilityName} onChange={(e) => setFacilityName(e.target.value)} /></Field><Field label="Facility phone"><input className={inputClass} value={facilityPhone} onChange={(e) => setFacilityPhone(e.target.value)} /></Field><Field label="Technician number"><input className={inputClass} value={technicianNumber} onChange={(e) => setTechnicianNumber(e.target.value)} /></Field><Field label="Technician name"><input className={inputClass} value={technicianName} onChange={(e) => setTechnicianName(e.target.value)} /></Field><Field label="Device ID"><input className={inputClass} value={deviceId} onChange={(e) => setDeviceId(e.target.value)} /></Field><Field label="Software version"><input className={inputClass} value={softwareVersion} onChange={(e) => setSoftwareVersion(e.target.value)} /></Field><Field label="Facility address"><textarea className={textareaClass} value={facilityAddress} onChange={(e) => setFacilityAddress(e.target.value)} /></Field><Field label="Notes"><textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div></section>
    </div>

    <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="flex items-center gap-2 text-xs font-bold"><FileText className="size-4 text-primary" />Evidence</h3>{evidence ? <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-50/60 p-3 dark:bg-emerald-950/20"><p className="text-xs font-bold">Evidence 1 of 1</p><p className="mt-1 break-all text-[11px] text-muted-foreground">{evidence.fileName}</p></div> : <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3"><p className="text-xs font-bold text-destructive">Certificate required</p><p className="mt-1 text-[11px] text-muted-foreground">Attach the original emission certificate before saving.</p></div>}</section>
      <section className="rounded-xl border border-border bg-card p-4"><h3 className="flex items-center gap-2 text-xs font-bold"><ShieldCheck className="size-4 text-primary" />Save checks</h3><div className="mt-3 space-y-2 text-[11px]"><p className="flex gap-2"><CheckCircle2 className="size-3.5 text-emerald-700" />VIN retained as primary identity</p><p className="flex gap-2"><CheckCircle2 className="size-3.5 text-emerald-700" />Plate linked by registration record ID</p><p className="flex gap-2"><CheckCircle2 className="size-3.5 text-emerald-700" />Source plate preserved separately</p><p className="flex gap-2"><CheckCircle2 className="size-3.5 text-emerald-700" />Applicable limit stored with result</p></div><button type="button" disabled={saving || mismatch} onClick={save} className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"><LockKeyhole className="size-4" />{saving ? "Saving…" : mismatch ? "Resolve identity conflict" : "Save emission test"}</button></section>
    </aside>
  </div>
}
