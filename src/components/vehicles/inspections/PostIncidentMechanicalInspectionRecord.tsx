"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, FileText, Link2, LockKeyhole, Wrench } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ISODateInput, isValidISODate } from "@/src/components/shared/ISODateInput"

export const POST_INCIDENT_INSPECTION_COMPLIANCE_BASIS = [
  { authority: "FMCSA", reference: "Post-crash inspection definition", url: "https://www.fmcsa.dot.gov/CCFP/definitions" },
  { authority: "FMCSA", reference: "49 CFR 390.15 — Accident register and supporting records", url: "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-390/subpart-B/section-390.15" },
  { authority: "FMCSA", reference: "49 CFR 396.3 — Inspection, repair and maintenance", url: "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396/section-396.3" },
  { authority: "CCMTA", reference: "NSC Standard 11 — Maintenance and mechanical condition", url: "https://www.ccmta.ca/web/default/files/PDF/NSC-English/CCMTA%20NSC%20Standard%2011%20-%20January%202020%20-%20ENG.pdf" },
] as const

export type IncidentType = "COLLISION" | "FIRE" | "ROLLOVER" | "CARGO_SHIFT" | "ROAD_HAZARD" | "MECHANICAL_FAILURE" | "OTHER"
export type IncidentInspectionAuthority = "LAW_ENFORCEMENT_CVSA" | "LICENSED_FACILITY" | "OEM_OR_SPECIALIST" | "INSURER_APPRAISER" | "INTERNAL_QUALIFIED_PERSON"
export type MechanicalItemResult = "PASS" | "FAIL" | "NOT_INSPECTED" | "NOT_APPLICABLE"
export type RoadworthinessOutcome = "CLEARED_FOR_SERVICE" | "RESTRICTED_OPERATION" | "NOT_ROADWORTHY" | "TOW_ONLY" | "SPECIALIST_REVIEW_REQUIRED"

export interface PostIncidentVehicleOption {
  id: string
  unitNumber: string
  vin: string
  equipmentType: string
  plate?: string
  plateJurisdiction?: string
}

export interface PostIncidentEvidence {
  id: string
  fileName: string
  kind?: "INCIDENT_REPORT" | "MECHANICAL_REPORT" | "PHOTO" | "REPAIR_EVIDENCE" | "OTHER"
}

export interface PostIncidentSystemResult {
  id: string
  system: string
  result: MechanicalItemResult
  finding?: string
  measurement?: string
  safetyCritical: boolean
  repairRequired: boolean
  linkedRepairRecordId?: string
  resolved: boolean
}

export interface PostIncidentMechanicalInspectionRecordModel {
  id: string
  companyId: string
  vehicleId: string
  recordType: "POST_INCIDENT_MECHANICAL_INSPECTION"
  incident: {
    incidentRecordId: string
    incidentType: IncidentType
    incidentDate: string
    incidentTime?: string
    location: string
    policeReportNumber?: string
    insuranceClaimNumber?: string
    towRequired: boolean
    vehicleOperatedAfterIncident: boolean
  }
  vehicle: {
    unitNumber: string
    vin: string
    equipmentType: string
    plate?: string
    plateJurisdiction?: string
    odometer?: number
    odometerUnit: "KM" | "MI"
  }
  inspection: {
    inspectedAt: string
    authority: IncidentInspectionAuthority
    reportNumber?: string
    organizationId: string
    facilityName: string
    facilityLicenceNumber?: string
    inspectorName: string
    inspectorContactId: string
    inspectorCredential?: string
    inspectionScopeStatement: string
  }
  systemResults: PostIncidentSystemResult[]
  roadworthiness: {
    outcome: RoadworthinessOutcome
    movementRestriction?: string
    returnToServiceAuthorized: boolean
    returnToServiceDate?: string
    authorizedBy?: string
    authorizationCredential?: string
  }
  linkedRepairRecordIds: string[]
  linkedRoadsideInspectionId?: string
  evidenceIds: string[]
  evidenceCompleteness: "COMPLETE" | "MISSING"
  recordState: "FINAL_LOCKED"
  notes?: string
  createdAt: string
  finalizedAt: string
}

const SYSTEMS = [
  "Frame / Structural Members",
  "Cab / Body / Mounting",
  "Steering",
  "Brakes",
  "Suspension / Axles",
  "Tires / Wheels / Hubs",
  "Coupling Devices",
  "Lighting / Electrical",
  "Fuel System / Fluid Leaks",
  "Windshield / Mirrors",
  "Cargo Securement Equipment",
  "Engine / Driveline",
  "Safety Systems / Airbags",
  "Other Affected System",
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

export function validatePostIncidentMechanicalInspection(record: PostIncidentMechanicalInspectionRecordModel): string[] {
  const errors: string[] = []
  if (!record.incident.incidentRecordId.trim()) errors.push("A permanent Incident Record link is required.")
  if (!isValidISODate(record.incident.incidentDate)) errors.push("Enter a valid incident date.")
  if (!record.incident.location.trim()) errors.push("Incident location is required.")
  if (!record.vehicle.vin) errors.push("VIN is required.")
  if (!record.inspection.inspectedAt) errors.push("Inspection date and time are required.")
  if (!record.inspection.facilityName.trim()) errors.push("Inspection facility or inspecting organization is required.")
  if (!record.inspection.organizationId.trim()) errors.push("Inspection facility must link to an Organization record.")
  if (!record.inspection.inspectorName.trim()) errors.push("Inspector name is required.")
  if (!record.inspection.inspectorContactId.trim()) errors.push("Inspector must link to a Contact record.")
  if (!record.inspection.inspectionScopeStatement.trim()) errors.push("Inspection scope is required.")
  if (!record.systemResults.some((item) => item.result !== "NOT_INSPECTED")) errors.push("Record at least one mechanically inspected system.")
  if (!record.evidenceIds.length) errors.push("The signed mechanical inspection report is required as evidence.")

  const unresolvedCritical = record.systemResults.filter((item) => item.result === "FAIL" && item.safetyCritical && !item.resolved)
  if (record.roadworthiness.outcome === "CLEARED_FOR_SERVICE" && unresolvedCritical.length) {
    errors.push("The vehicle cannot be cleared for service while a safety-critical failure remains unresolved.")
  }
  if (record.roadworthiness.returnToServiceAuthorized && record.roadworthiness.outcome !== "CLEARED_FOR_SERVICE") {
    errors.push("Return-to-service authorization requires a Cleared for Service outcome.")
  }
  if (record.roadworthiness.returnToServiceAuthorized && (!record.roadworthiness.returnToServiceDate || !record.roadworthiness.authorizedBy)) {
    errors.push("Return-to-service date and authorizing person are required.")
  }
  const repairWithoutLink = record.systemResults.some((item) => item.repairRequired && !item.resolved && !item.linkedRepairRecordId)
  if (repairWithoutLink) errors.push("Each unresolved repair-required finding must link to a Repair Record before final save.")
  return errors
}

type Props = {
  companyId: string
  vehicles: PostIncidentVehicleOption[]
  evidence: PostIncidentEvidence[]
  incidentOptions?: { id: string; label: string; date?: string; location?: string }[]
  organizationOptions?: { id: string; name: string }[]
  contactOptions?: { id: string; name: string }[]
  onSave: (record: PostIncidentMechanicalInspectionRecordModel) => Promise<void>
}

export function PostIncidentMechanicalInspectionRecord({ companyId, vehicles, evidence, incidentOptions = [], organizationOptions = [], contactOptions = [], onSave }: Props) {
  const [vehicleId, setVehicleId] = React.useState(vehicles[0]?.id || "")
  const [incidentId, setIncidentId] = React.useState(incidentOptions[0]?.id || "")
  const [incidentType, setIncidentType] = React.useState<IncidentType>("COLLISION")
  const [incidentDate, setIncidentDate] = React.useState(incidentOptions[0]?.date || "")
  const [incidentTime, setIncidentTime] = React.useState("")
  const [location, setLocation] = React.useState(incidentOptions[0]?.location || "")
  const [policeReport, setPoliceReport] = React.useState("")
  const [insuranceClaim, setInsuranceClaim] = React.useState("")
  const [towRequired, setTowRequired] = React.useState(false)
  const [operatedAfter, setOperatedAfter] = React.useState(false)
  const [odometer, setOdometer] = React.useState("")
  const [odometerUnit, setOdometerUnit] = React.useState<"KM" | "MI">("KM")
  const [inspectedAt, setInspectedAt] = React.useState("")
  const [authority, setAuthority] = React.useState<IncidentInspectionAuthority>("LICENSED_FACILITY")
  const [reportNumber, setReportNumber] = React.useState("")
  const [facilityOrganizationId, setFacilityOrganizationId] = React.useState("")
  const [facilityName, setFacilityName] = React.useState("")
  const [facilityLicence, setFacilityLicence] = React.useState("")
  const [inspectorName, setInspectorName] = React.useState("")
  const [inspectorContactId, setInspectorContactId] = React.useState("")
  const [inspectorCredential, setInspectorCredential] = React.useState("")
  const [scope, setScope] = React.useState("")
  const [systemResults, setSystemResults] = React.useState<PostIncidentSystemResult[]>([])
  const [outcome, setOutcome] = React.useState<RoadworthinessOutcome>("SPECIALIST_REVIEW_REQUIRED")
  const [restriction, setRestriction] = React.useState("")
  const [returnAuthorized, setReturnAuthorized] = React.useState(false)
  const [returnDate, setReturnDate] = React.useState("")
  const [authorizedBy, setAuthorizedBy] = React.useState("")
  const [authorizationCredential, setAuthorizationCredential] = React.useState("")
  const [linkedRoadsideId, setLinkedRoadsideId] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [errors, setErrors] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const [sideTab, setSideTab] = React.useState<"EVIDENCE" | "DETAILS" | "ACTIVITY">("EVIDENCE")

  const vehicle = vehicles.find((item) => item.id === vehicleId)
  const unresolvedCritical = systemResults.filter((item) => item.result === "FAIL" && item.safetyCritical && !item.resolved).length

  function addSystem() {
    setSystemResults((current) => [...current, {
      id: crypto.randomUUID(), system: "Frame / Structural Members", result: "NOT_INSPECTED",
      safetyCritical: true, repairRequired: false, resolved: false,
    }])
  }

  function updateSystem(id: string, patch: Partial<PostIncidentSystemResult>) {
    setSystemResults((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  async function save() {
    if (!vehicle) return setErrors(["Select a vehicle."])
    const now = new Date().toISOString()
    const linkedRepairRecordIds = Array.from(new Set(systemResults.map((item) => item.linkedRepairRecordId).filter((value): value is string => Boolean(value))))
    const record: PostIncidentMechanicalInspectionRecordModel = {
      id: crypto.randomUUID(), companyId, vehicleId: vehicle.id, recordType: "POST_INCIDENT_MECHANICAL_INSPECTION",
      incident: {
        incidentRecordId: incidentId.trim(), incidentType, incidentDate, incidentTime: incidentTime || undefined,
        location: location.trim(), policeReportNumber: policeReport.trim() || undefined,
        insuranceClaimNumber: insuranceClaim.trim() || undefined, towRequired, vehicleOperatedAfterIncident: operatedAfter,
      },
      vehicle: { unitNumber: vehicle.unitNumber, vin: vehicle.vin, equipmentType: vehicle.equipmentType, plate: vehicle.plate, plateJurisdiction: vehicle.plateJurisdiction, odometer: numberOrUndefined(odometer), odometerUnit },
      inspection: {
        inspectedAt, authority, reportNumber: reportNumber.trim() || undefined, organizationId: facilityOrganizationId.trim(), facilityName: facilityName.trim(),
        facilityLicenceNumber: facilityLicence.trim() || undefined, inspectorName: inspectorName.trim(),
        inspectorContactId: inspectorContactId.trim(), inspectorCredential: inspectorCredential.trim() || undefined, inspectionScopeStatement: scope.trim(),
      },
      systemResults,
      roadworthiness: {
        outcome, movementRestriction: restriction.trim() || undefined, returnToServiceAuthorized: returnAuthorized,
        returnToServiceDate: returnDate || undefined, authorizedBy: authorizedBy.trim() || undefined,
        authorizationCredential: authorizationCredential.trim() || undefined,
      },
      linkedRepairRecordIds, linkedRoadsideInspectionId: linkedRoadsideId.trim() || undefined,
      evidenceIds: evidence.map((item) => item.id), evidenceCompleteness: evidence.length ? "COMPLETE" : "MISSING",
      recordState: "FINAL_LOCKED", notes: notes.trim() || undefined, createdAt: now, finalizedAt: now,
    }
    const validation = validatePostIncidentMechanicalInspection(record)
    if (validation.length) return setErrors(validation)
    setSaving(true); setErrors([])
    try { await onSave(record) }
    catch (cause) { setErrors([cause instanceof Error ? cause.message : "Post-incident inspection could not be saved."]) }
    finally { setSaving(false) }
  }

  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
    <main className="space-y-4">
      <Card className="p-4"><div className="mb-4 flex items-start justify-between"><div><h2 className="text-sm font-bold">Post-Incident Mechanical Inspection</h2><p className="mt-1 text-xs text-muted-foreground">Determines mechanical condition and roadworthiness after a linked incident.</p></div><span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700"><LockKeyhole className="size-3" />Final save locks record</span></div>
        {errors.length ? <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive"><ul className="list-disc space-y-1 pl-4">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Vehicle" required><select className={inputClass} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>{vehicles.map((item) => <option key={item.id} value={item.id}>Unit {item.unitNumber} · {item.vin}</option>)}</select></Field>
          <Field label="Linked Incident Record" required>{incidentOptions.length ? <select className={inputClass} value={incidentId} onChange={(e) => setIncidentId(e.target.value)}><option value="">Select incident</option>{incidentOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <Input className={inputClass} value={incidentId} onChange={(e) => setIncidentId(e.target.value)} />}</Field>
          <Field label="Incident type" required><select className={inputClass} value={incidentType} onChange={(e) => setIncidentType(e.target.value as IncidentType)}>{["COLLISION","FIRE","ROLLOVER","CARGO_SHIFT","ROAD_HAZARD","MECHANICAL_FAILURE","OTHER"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></Field>
          <Field label="Incident date" required><ISODateInput className={inputClass} value={incidentDate} onValueChange={setIncidentDate} /></Field>
          <Field label="Incident time"><Input className={inputClass} type="time" value={incidentTime} onChange={(e) => setIncidentTime(e.target.value)} /></Field>
          <Field label="Incident location" required><Input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          <Field label="Police report number"><Input className={inputClass} value={policeReport} onChange={(e) => setPoliceReport(e.target.value)} /></Field>
          <Field label="Insurance claim number"><Input className={inputClass} value={insuranceClaim} onChange={(e) => setInsuranceClaim(e.target.value)} /></Field>
          <Field label="Odometer"><div className="grid grid-cols-[1fr_76px] gap-2"><Input className={inputClass} inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} /><select className={inputClass} value={odometerUnit} onChange={(e) => setOdometerUnit(e.target.value as "KM" | "MI")}><option>KM</option><option>MI</option></select></div></Field>
          <Field label="Tow required"><select className={inputClass} value={towRequired ? "YES" : "NO"} onChange={(e) => setTowRequired(e.target.value === "YES")}><option value="NO">No</option><option value="YES">Yes</option></select></Field>
          <Field label="Operated after incident"><select className={inputClass} value={operatedAfter ? "YES" : "NO"} onChange={(e) => setOperatedAfter(e.target.value === "YES")}><option value="NO">No</option><option value="YES">Yes</option></select></Field>
          <Field label="Linked roadside/CVSA record"><Input className={inputClass} value={linkedRoadsideId} onChange={(e) => setLinkedRoadsideId(e.target.value)} /></Field>
        </div>
      </Card>

      <Card className="p-4"><h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Mechanical inspection authority</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Inspection date/time" required><Input className={inputClass} type="datetime-local" value={inspectedAt} onChange={(e) => setInspectedAt(e.target.value)} /></Field>
        <Field label="Inspection authority" required><select className={inputClass} value={authority} onChange={(e) => setAuthority(e.target.value as IncidentInspectionAuthority)}>{["LAW_ENFORCEMENT_CVSA","LICENSED_FACILITY","OEM_OR_SPECIALIST","INSURER_APPRAISER","INTERNAL_QUALIFIED_PERSON"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></Field>
        <Field label="Report number"><Input className={inputClass} value={reportNumber} onChange={(e) => setReportNumber(e.target.value)} /></Field>
        <Field label="Facility / organization" required><Input className={inputClass} value={facilityName} onChange={(e) => setFacilityName(e.target.value)} /></Field>
        <Field label="Linked facility organization" required>{organizationOptions.length ? <select className={inputClass} value={facilityOrganizationId} onChange={(e) => { const option = organizationOptions.find((item) => item.id === e.target.value); setFacilityOrganizationId(e.target.value); if (option) setFacilityName(option.name) }}><option value="">Select organization</option>{organizationOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <Input className={inputClass} placeholder="Organization record ID" value={facilityOrganizationId} onChange={(e) => setFacilityOrganizationId(e.target.value)} />}</Field>
        <Field label="Facility licence"><Input className={inputClass} value={facilityLicence} onChange={(e) => setFacilityLicence(e.target.value)} /></Field>
        <Field label="Inspector" required><Input className={inputClass} value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} /></Field>
        <Field label="Linked inspector contact" required>{contactOptions.length ? <select className={inputClass} value={inspectorContactId} onChange={(e) => { const option = contactOptions.find((item) => item.id === e.target.value); setInspectorContactId(e.target.value); if (option) setInspectorName(option.name) }}><option value="">Select contact</option>{contactOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <Input className={inputClass} placeholder="Contact record ID" value={inspectorContactId} onChange={(e) => setInspectorContactId(e.target.value)} />}</Field>
        <Field label="Inspector credential"><Input className={inputClass} value={inspectorCredential} onChange={(e) => setInspectorCredential(e.target.value)} /></Field>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Inspection scope statement" required><Textarea className={areaClass} placeholder="Describe the impact areas and the mechanical/structural scope actually examined." value={scope} onChange={(e) => setScope(e.target.value)} /></Field></div>
      </div></Card>

      <Card className="p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold">Inspected systems</h3><p className="mt-1 text-[11px] text-muted-foreground">Record only systems actually examined. Safety-critical failures block return to service.</p></div><Button variant="outline" size="sm" onClick={addSystem}>Add system</Button></div>
        <div className="space-y-2">{systemResults.map((item) => <div className="grid gap-2 rounded-lg border p-3 lg:grid-cols-12" key={item.id}>
          <select className={`${inputClass} lg:col-span-3`} value={item.system} onChange={(e) => updateSystem(item.id, { system: e.target.value })}>{SYSTEMS.map((system) => <option key={system}>{system}</option>)}</select>
          <select className={`${inputClass} lg:col-span-2`} value={item.result} onChange={(e) => updateSystem(item.id, { result: e.target.value as MechanicalItemResult })}>{["PASS","FAIL","NOT_INSPECTED","NOT_APPLICABLE"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select>
          <Input className="lg:col-span-4" placeholder="Finding / damage / measurement" value={item.finding || ""} onChange={(e) => updateSystem(item.id, { finding: e.target.value })} />
          <label className="flex items-center gap-2 text-[11px] lg:col-span-1"><input type="checkbox" checked={item.safetyCritical} onChange={(e) => updateSystem(item.id, { safetyCritical: e.target.checked })} />Critical</label>
          <label className="flex items-center gap-2 text-[11px] lg:col-span-1"><input type="checkbox" checked={item.resolved} onChange={(e) => updateSystem(item.id, { resolved: e.target.checked })} />Resolved</label>
          <Button className="lg:col-span-1" variant="ghost" size="sm" onClick={() => setSystemResults((current) => current.filter((row) => row.id !== item.id))}>Remove</Button>
          <Input className="lg:col-span-6" placeholder="Linked Repair Record ID (required if unresolved repair is needed)" value={item.linkedRepairRecordId || ""} onChange={(e) => updateSystem(item.id, { linkedRepairRecordId: e.target.value, repairRequired: Boolean(e.target.value) || item.repairRequired })} />
          <label className="flex items-center gap-2 text-[11px] lg:col-span-3"><input type="checkbox" checked={item.repairRequired} onChange={(e) => updateSystem(item.id, { repairRequired: e.target.checked })} />Repair required</label>
        </div>)}</div>
      </Card>

      <Card className="p-4"><h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Roadworthiness and return to service</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Roadworthiness outcome" required><select className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value as RoadworthinessOutcome)}>{["CLEARED_FOR_SERVICE","RESTRICTED_OPERATION","NOT_ROADWORTHY","TOW_ONLY","SPECIALIST_REVIEW_REQUIRED"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></Field>
        <Field label="Movement restriction"><Input className={inputClass} value={restriction} onChange={(e) => setRestriction(e.target.value)} /></Field>
        <Field label="Return to service authorized"><select className={inputClass} value={returnAuthorized ? "YES" : "NO"} onChange={(e) => setReturnAuthorized(e.target.value === "YES")}><option value="NO">No</option><option value="YES">Yes</option></select></Field>
        <Field label="Return-to-service date"><ISODateInput className={inputClass} value={returnDate} onValueChange={setReturnDate} /></Field>
        <Field label="Authorized by"><Input className={inputClass} value={authorizedBy} onChange={(e) => setAuthorizedBy(e.target.value)} /></Field>
        <Field label="Authorization credential"><Input className={inputClass} value={authorizationCredential} onChange={(e) => setAuthorizationCredential(e.target.value)} /></Field>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Notes"><Textarea className={areaClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      </div><div className="mt-4 flex justify-end"><Button disabled={saving} onClick={save}>{saving ? "Finalizing…" : "Finalize & Lock Inspection"}</Button></div></Card>
    </main>

    <aside className="xl:sticky xl:top-4 xl:self-start"><Card className="overflow-hidden"><div className="grid grid-cols-3 border-b">{(["EVIDENCE","DETAILS","ACTIVITY"] as const).map((tab) => <button className={`px-2 py-3 text-[10px] font-bold ${sideTab === tab ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`} key={tab} onClick={() => setSideTab(tab)}>{tab}</button>)}</div><div className="p-4">
      {sideTab === "EVIDENCE" ? <div className="space-y-3"><div className={`rounded-lg border p-3 ${evidence.length ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}`}>{evidence.length ? <CheckCircle2 className="mb-2 size-5 text-emerald-600" /> : <AlertTriangle className="mb-2 size-5 text-amber-600" />}<p className="text-xs font-bold">{evidence.length ? `${evidence.length} evidence file${evidence.length === 1 ? "" : "s"}` : "Mechanical report missing"}</p></div>{evidence.map((item) => <div className="flex gap-2 rounded-lg border p-2 text-xs" key={item.id}><FileText className="size-4 text-primary" /><span><b className="block">{item.kind || "EVIDENCE"}</b>{item.fileName}</span></div>)}</div> : null}
      {sideTab === "DETAILS" ? <dl className="space-y-3 text-xs"><div><dt className="text-muted-foreground">Vehicle</dt><dd className="font-bold">{vehicle ? `Unit ${vehicle.unitNumber}` : "Not selected"}</dd></div><div><dt className="text-muted-foreground">Incident link</dt><dd className="font-bold">{incidentId || "Missing"}</dd></div><div><dt className="text-muted-foreground">Unresolved critical failures</dt><dd className={unresolvedCritical ? "font-bold text-destructive" : "font-bold text-emerald-700"}>{unresolvedCritical}</dd></div><div><dt className="text-muted-foreground">Permanent links</dt><dd className="mt-1 flex items-center gap-1 font-bold text-primary"><Link2 className="size-3" />Incident · Vehicle · Repairs</dd></div></dl> : null}
      {sideTab === "ACTIVITY" ? <div className="space-y-3 text-xs"><div className="flex gap-2"><Wrench className="size-4 text-primary" /><div><p className="font-bold">Mechanical review draft</p><p className="text-muted-foreground">Final save creates an immutable inspection record.</p></div></div><p className="rounded-lg bg-muted p-3 text-[11px] text-muted-foreground">Corrections after finalization must be appended as a superseding record; the original is never overwritten.</p></div> : null}
    </div></Card></aside>
  </div>
}
