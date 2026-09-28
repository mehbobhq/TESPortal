"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, FileText, Link2, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ISODateInput, isValidISODate } from "@/src/components/shared/ISODateInput"

export const PROVINCIAL_STATE_SAFETY_COMPLIANCE_BASIS = [
  { authority: "CCMTA", reference: "NSC Standard 11 Part B — Periodic Commercial Motor Vehicle Inspections", url: "https://www.ccmta.ca/web/default/files/PDF/NSC-English/CCMTA%20NSC%20Standard%2011%20-%20January%202020%20-%20ENG.pdf" },
  { authority: "FMCSA", reference: "49 CFR 396.23 — State or other jurisdiction inspection equivalency", url: "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396/section-396.23" },
  { authority: "Ontario MTO", reference: "DriveON commercial vehicle safety inspections", url: "https://www.ontario.ca/page/get-safety-or-emissions-inspection-commercial-vehicle" },
] as const

export type SafetyInspectionCountry = "CA" | "US"
export type SafetyInspectionPurpose =
  | "PERIODIC_COMPLIANCE"
  | "REGISTRATION_OR_TRANSFER"
  | "OUT_OF_PROVINCE_OR_STATE"
  | "STRUCTURAL_OR_REBUILT"
  | "OTHER_STATUTORY_REQUIREMENT"

export type AnnualRelationship =
  | "SEPARATE_LEGAL_REQUIREMENT"
  | "SATISFIES_ANNUAL_EQUIVALENT"
  | "UNKNOWN_REVIEW_REQUIRED"

export type SafetyInspectionResult = "PASS" | "FAIL" | "CONDITIONAL_OR_INTERIM" | "VOID"
export type SafetyItemResult = "PASS" | "FAIL" | "NOT_REPORTED" | "NOT_APPLICABLE"

export interface SafetyInspectionVehicleOption {
  id: string
  unitNumber: string
  vin: string
  equipmentType: string
  plate?: string
  plateJurisdiction?: string
  activeRegistrationRecordId?: string
}

export interface SafetyInspectionEvidence {
  id: string
  fileName: string
  verificationStatus?: "VERIFIED" | "REVIEW_REQUIRED"
}

export interface SafetyInspectionFinding {
  id: string
  system: string
  result: SafetyItemResult
  sourceDescription: string
  measurement?: string
  correctedBeforeCertificate: boolean
  repairRequired: boolean
  linkedRepairRecordId?: string
}

export interface ProvincialStateSafetyInspectionRecordModel {
  id: string
  companyId: string
  vehicleId: string
  recordType: "PROVINCIAL_STATE_SAFETY_INSPECTION"
  country: SafetyInspectionCountry
  jurisdiction: string
  programName: string
  purpose: SafetyInspectionPurpose
  annualRelationship: AnnualRelationship
  legalAuthorityOrRule?: string
  ruleVersion?: string
  inspectionDate: string
  certificateValidUntil?: string
  decalExpiryDate?: string
  sourceResult: string
  normalizedResult: SafetyInspectionResult
  certificateNumber?: string
  reportNumber?: string
  decalNumber?: string
  reinspectionOfRecordId?: string
  vehicle: {
    unitNumber: string
    vin: string
    equipmentType: string
    sourcePlate?: string
    sourcePlateJurisdiction?: string
    linkedRegistrationRecordId?: string
    odometer?: number
    odometerUnit: "KM" | "MI"
  }
  facility: {
    organizationId?: string
    facilityName: string
    facilityLicenceNumber?: string
    address?: string
    phone?: string
  }
  inspector: {
    contactId?: string
    name: string
    technicianLicenceNumber?: string
    qualificationJurisdiction?: string
    signaturePresent: boolean
  }
  ownerOperator: {
    organizationId?: string
    name: string
  }
  findings: SafetyInspectionFinding[]
  evidenceIds: string[]
  evidenceCompleteness: "COMPLETE" | "MISSING" | "REVIEW_REQUIRED"
  notes?: string
  createdAt: string
}

const SYSTEMS = [
  "Powertrain / Fuel System",
  "Suspension",
  "Brakes",
  "Steering",
  "Instruments / Auxiliary Equipment",
  "Lamps / Electrical",
  "Body / Cab",
  "Tires / Wheels / Hubs",
  "Windshield / Windows",
  "Coupling Devices",
  "Other Jurisdiction-Specific Item",
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

export function validateProvincialStateSafetyInspection(record: ProvincialStateSafetyInspectionRecordModel): string[] {
  const errors: string[] = []
  if (!record.vehicleId) errors.push("Vehicle is required.")
  if (!record.vehicle.vin) errors.push("VIN is required.")
  if (!record.jurisdiction.trim()) errors.push("Inspection jurisdiction is required.")
  if (!record.programName.trim()) errors.push("Official program name is required.")
  if (!isValidISODate(record.inspectionDate)) errors.push("Enter a valid inspection date.")
  if (!record.facility.facilityName.trim()) errors.push("Inspection facility is required.")
  if (!record.facility.organizationId) errors.push("Inspection facility must link to an Organization record.")
  if (!record.inspector.name.trim()) errors.push("Inspector or technician is required.")
  if (!record.inspector.contactId) errors.push("Inspector must link to a Contact record.")
  if (!record.ownerOperator.name.trim()) errors.push("Owner/operator is required.")
  if (!record.ownerOperator.organizationId) errors.push("Owner/operator must link to an Organization record.")
  if (!record.certificateNumber && !record.reportNumber && !record.decalNumber) errors.push("Enter at least one source certificate, report or decal number.")
  if (!record.evidenceIds.length) errors.push("The official inspection report or certificate is required as evidence.")
  if (record.purpose === "PERIODIC_COMPLIANCE" && record.normalizedResult === "PASS" && !record.decalExpiryDate && !record.certificateValidUntil) {
    errors.push("A passed periodic inspection requires the source validity or decal expiry date when issued.")
  }
  if (record.normalizedResult === "PASS" && record.findings.some((item) => item.result === "FAIL" && !item.correctedBeforeCertificate)) {
    errors.push("A passed record cannot contain an uncorrected failed item.")
  }
  if (record.annualRelationship === "UNKNOWN_REVIEW_REQUIRED") errors.push("Confirm whether this program is legally separate from, or equivalent to, the annual inspection.")
  return errors
}

type Props = {
  companyId: string
  vehicles: SafetyInspectionVehicleOption[]
  evidence: SafetyInspectionEvidence[]
  ownerOperatorName: string
  ownerOperatorOrganizationId?: string
  organizationOptions?: { id: string; name: string }[]
  contactOptions?: { id: string; name: string }[]
  onSave: (record: ProvincialStateSafetyInspectionRecordModel) => Promise<void>
}

export function ProvincialStateSafetyInspectionRecord({ companyId, vehicles, evidence, ownerOperatorName, ownerOperatorOrganizationId, organizationOptions = [], contactOptions = [], onSave }: Props) {
  const [vehicleId, setVehicleId] = React.useState(vehicles[0]?.id || "")
  const [country, setCountry] = React.useState<SafetyInspectionCountry>("CA")
  const [jurisdiction, setJurisdiction] = React.useState("")
  const [programName, setProgramName] = React.useState("")
  const [purpose, setPurpose] = React.useState<SafetyInspectionPurpose>("REGISTRATION_OR_TRANSFER")
  const [annualRelationship, setAnnualRelationship] = React.useState<AnnualRelationship>("SEPARATE_LEGAL_REQUIREMENT")
  const [legalAuthority, setLegalAuthority] = React.useState("")
  const [ruleVersion, setRuleVersion] = React.useState("")
  const [inspectionDate, setInspectionDate] = React.useState("")
  const [validUntil, setValidUntil] = React.useState("")
  const [decalExpiry, setDecalExpiry] = React.useState("")
  const [result, setResult] = React.useState<SafetyInspectionResult>("PASS")
  const [sourceResult, setSourceResult] = React.useState("Pass")
  const [certificateNumber, setCertificateNumber] = React.useState("")
  const [reportNumber, setReportNumber] = React.useState("")
  const [decalNumber, setDecalNumber] = React.useState("")
  const [plate, setPlate] = React.useState("")
  const [plateJurisdiction, setPlateJurisdiction] = React.useState("")
  const [odometer, setOdometer] = React.useState("")
  const [odometerUnit, setOdometerUnit] = React.useState<"KM" | "MI">("KM")
  const [facilityName, setFacilityName] = React.useState("")
  const [facilityOrganizationId, setFacilityOrganizationId] = React.useState("")
  const [facilityLicence, setFacilityLicence] = React.useState("")
  const [facilityAddress, setFacilityAddress] = React.useState("")
  const [facilityPhone, setFacilityPhone] = React.useState("")
  const [inspectorName, setInspectorName] = React.useState("")
  const [inspectorContactId, setInspectorContactId] = React.useState("")
  const [technicianLicence, setTechnicianLicence] = React.useState("")
  const [signaturePresent, setSignaturePresent] = React.useState(false)
  const [ownerName, setOwnerName] = React.useState(ownerOperatorName)
  const [ownerOrganizationId, setOwnerOrganizationId] = React.useState(ownerOperatorOrganizationId || companyId)
  const [findings, setFindings] = React.useState<SafetyInspectionFinding[]>([])
  const [notes, setNotes] = React.useState("")
  const [errors, setErrors] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const [sideTab, setSideTab] = React.useState<"EVIDENCE" | "DETAILS" | "ACTIVITY">("EVIDENCE")

  const vehicle = vehicles.find((item) => item.id === vehicleId)

  function addFinding() {
    setFindings((current) => [...current, {
      id: crypto.randomUUID(), system: "Brakes", result: "FAIL", sourceDescription: "",
      correctedBeforeCertificate: false, repairRequired: true,
    }])
  }

  function updateFinding(id: string, patch: Partial<SafetyInspectionFinding>) {
    setFindings((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  async function save() {
    if (!vehicle) return setErrors(["Select a vehicle."])
    const record: ProvincialStateSafetyInspectionRecordModel = {
      id: crypto.randomUUID(), companyId, vehicleId: vehicle.id, recordType: "PROVINCIAL_STATE_SAFETY_INSPECTION",
      country, jurisdiction: jurisdiction.trim(), programName: programName.trim(), purpose, annualRelationship,
      legalAuthorityOrRule: legalAuthority.trim() || undefined, ruleVersion: ruleVersion.trim() || undefined,
      inspectionDate, certificateValidUntil: validUntil || undefined, decalExpiryDate: decalExpiry || undefined,
      sourceResult: sourceResult.trim(), normalizedResult: result,
      certificateNumber: certificateNumber.trim() || undefined, reportNumber: reportNumber.trim() || undefined,
      decalNumber: decalNumber.trim() || undefined,
      vehicle: {
        unitNumber: vehicle.unitNumber, vin: vehicle.vin, equipmentType: vehicle.equipmentType,
        sourcePlate: plate.trim() || vehicle.plate, sourcePlateJurisdiction: plateJurisdiction.trim() || vehicle.plateJurisdiction,
        linkedRegistrationRecordId: vehicle.activeRegistrationRecordId, odometer: numberOrUndefined(odometer), odometerUnit,
      },
      facility: { organizationId: facilityOrganizationId.trim() || undefined, facilityName: facilityName.trim(), facilityLicenceNumber: facilityLicence.trim() || undefined, address: facilityAddress.trim() || undefined, phone: facilityPhone.trim() || undefined },
      inspector: { contactId: inspectorContactId.trim() || undefined, name: inspectorName.trim(), technicianLicenceNumber: technicianLicence.trim() || undefined, qualificationJurisdiction: jurisdiction.trim() || undefined, signaturePresent },
      ownerOperator: { organizationId: ownerOrganizationId.trim() || undefined, name: ownerName.trim() }, findings,
      evidenceIds: evidence.map((item) => item.id),
      evidenceCompleteness: evidence.length ? evidence.some((item) => item.verificationStatus === "REVIEW_REQUIRED") ? "REVIEW_REQUIRED" : "COMPLETE" : "MISSING",
      notes: notes.trim() || undefined, createdAt: new Date().toISOString(),
    }
    const validation = validateProvincialStateSafetyInspection(record)
    if (validation.length) return setErrors(validation)
    setSaving(true); setErrors([])
    try { await onSave(record) }
    catch (cause) { setErrors([cause instanceof Error ? cause.message : "Safety inspection could not be saved."]) }
    finally { setSaving(false) }
  }

  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
    <main className="space-y-4">
      <Card className="p-4">
        <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-sm font-bold">Provincial or State Safety Inspection</h2><p className="mt-1 text-xs text-muted-foreground">Use only when the jurisdictional certificate is legally distinct or must be separately identified.</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold">Draft</span></div>
        {errors.length ? <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive"><ul className="list-disc space-y-1 pl-4">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Vehicle" required><select className={inputClass} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>{vehicles.map((item) => <option key={item.id} value={item.id}>Unit {item.unitNumber} · {item.vin}</option>)}</select></Field>
          <Field label="Country" required><select className={inputClass} value={country} onChange={(e) => setCountry(e.target.value as SafetyInspectionCountry)}><option value="CA">Canada</option><option value="US">United States</option></select></Field>
          <Field label="Province or state" required><Input className={inputClass} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value.toUpperCase())} /></Field>
          <Field label="Official program name" required><Input className={inputClass} placeholder="Example: Ontario DriveON" value={programName} onChange={(e) => setProgramName(e.target.value)} /></Field>
          <Field label="Legal purpose" required><select className={inputClass} value={purpose} onChange={(e) => setPurpose(e.target.value as SafetyInspectionPurpose)}>{["PERIODIC_COMPLIANCE","REGISTRATION_OR_TRANSFER","OUT_OF_PROVINCE_OR_STATE","STRUCTURAL_OR_REBUILT","OTHER_STATUTORY_REQUIREMENT"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></Field>
          <Field label="Relationship to annual inspection" required><select className={inputClass} value={annualRelationship} onChange={(e) => setAnnualRelationship(e.target.value as AnnualRelationship)}>{["SEPARATE_LEGAL_REQUIREMENT","SATISFIES_ANNUAL_EQUIVALENT","UNKNOWN_REVIEW_REQUIRED"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></Field>
          <Field label="Inspection date" required><ISODateInput className={inputClass} value={inspectionDate} onValueChange={setInspectionDate} /></Field>
          <Field label="Certificate valid until"><ISODateInput className={inputClass} value={validUntil} onValueChange={setValidUntil} /></Field>
          <Field label="Decal expiry"><ISODateInput className={inputClass} value={decalExpiry} onValueChange={setDecalExpiry} /></Field>
          <Field label="Normalized result" required><select className={inputClass} value={result} onChange={(e) => setResult(e.target.value as SafetyInspectionResult)}>{["PASS","FAIL","CONDITIONAL_OR_INTERIM","VOID"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select></Field>
          <Field label="Result printed on source"><Input className={inputClass} value={sourceResult} onChange={(e) => setSourceResult(e.target.value)} /></Field>
          <Field label="Odometer"><div className="grid grid-cols-[1fr_76px] gap-2"><Input className={inputClass} inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} /><select className={inputClass} value={odometerUnit} onChange={(e) => setOdometerUnit(e.target.value as "KM" | "MI")}><option>KM</option><option>MI</option></select></div></Field>
          <Field label="Certificate number"><Input className={inputClass} value={certificateNumber} onChange={(e) => setCertificateNumber(e.target.value)} /></Field>
          <Field label="Report number"><Input className={inputClass} value={reportNumber} onChange={(e) => setReportNumber(e.target.value)} /></Field>
          <Field label="Decal number"><Input className={inputClass} value={decalNumber} onChange={(e) => setDecalNumber(e.target.value)} /></Field>
          <Field label="Plate shown on source"><Input className={inputClass} value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} /></Field>
          <Field label="Plate jurisdiction"><Input className={inputClass} value={plateJurisdiction} onChange={(e) => setPlateJurisdiction(e.target.value.toUpperCase())} /></Field>
          <Field label="Legal authority / rule"><Input className={inputClass} value={legalAuthority} onChange={(e) => setLegalAuthority(e.target.value)} /></Field>
          <Field label="Rule or form version"><Input className={inputClass} value={ruleVersion} onChange={(e) => setRuleVersion(e.target.value)} /></Field>
        </div>
      </Card>

      <Card className="p-4"><h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Facility, inspector and owner/operator</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Inspection facility" required><Input className={inputClass} value={facilityName} onChange={(e) => setFacilityName(e.target.value)} /></Field>
        <Field label="Linked facility organization" required>{organizationOptions.length ? <select className={inputClass} value={facilityOrganizationId} onChange={(e) => { const option = organizationOptions.find((item) => item.id === e.target.value); setFacilityOrganizationId(e.target.value); if (option) setFacilityName(option.name) }}><option value="">Select organization</option>{organizationOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <Input className={inputClass} placeholder="Organization record ID" value={facilityOrganizationId} onChange={(e) => setFacilityOrganizationId(e.target.value)} />}</Field>
        <Field label="Facility licence number"><Input className={inputClass} value={facilityLicence} onChange={(e) => setFacilityLicence(e.target.value)} /></Field>
        <Field label="Facility phone"><Input className={inputClass} value={facilityPhone} onChange={(e) => setFacilityPhone(e.target.value)} /></Field>
        <Field label="Facility address"><Input className={inputClass} value={facilityAddress} onChange={(e) => setFacilityAddress(e.target.value)} /></Field>
        <Field label="Inspector / technician" required><Input className={inputClass} value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} /></Field>
        <Field label="Linked inspector contact" required>{contactOptions.length ? <select className={inputClass} value={inspectorContactId} onChange={(e) => { const option = contactOptions.find((item) => item.id === e.target.value); setInspectorContactId(e.target.value); if (option) setInspectorName(option.name) }}><option value="">Select contact</option>{contactOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <Input className={inputClass} placeholder="Contact record ID" value={inspectorContactId} onChange={(e) => setInspectorContactId(e.target.value)} />}</Field>
        <Field label="Technician licence"><Input className={inputClass} value={technicianLicence} onChange={(e) => setTechnicianLicence(e.target.value)} /></Field>
        <Field label="Owner / operator" required><Input className={inputClass} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} /></Field>
        <Field label="Linked owner organization" required>{organizationOptions.length ? <select className={inputClass} value={ownerOrganizationId} onChange={(e) => { const option = organizationOptions.find((item) => item.id === e.target.value); setOwnerOrganizationId(e.target.value); if (option) setOwnerName(option.name) }}><option value="">Select organization</option>{organizationOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <Input className={inputClass} placeholder="Organization record ID" value={ownerOrganizationId} onChange={(e) => setOwnerOrganizationId(e.target.value)} />}</Field>
        <Field label="Signature shown"><select className={inputClass} value={signaturePresent ? "YES" : "NO"} onChange={(e) => setSignaturePresent(e.target.value === "YES")}><option value="YES">Yes</option><option value="NO">No / not shown</option></select></Field>
      </div></Card>

      <Card className="p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold">Failed or specifically reported items</h3><p className="mt-1 text-[11px] text-muted-foreground">Do not manufacture pass results for systems the source document does not itemize.</p></div><Button variant="outline" size="sm" onClick={addFinding}>Add item</Button></div>
        <div className="space-y-2">{findings.map((item) => <div className="grid gap-2 rounded-lg border p-3 lg:grid-cols-12" key={item.id}>
          <select className={`${inputClass} lg:col-span-3`} value={item.system} onChange={(e) => updateFinding(item.id, { system: e.target.value })}>{SYSTEMS.map((system) => <option key={system}>{system}</option>)}</select>
          <select className={`${inputClass} lg:col-span-2`} value={item.result} onChange={(e) => updateFinding(item.id, { result: e.target.value as SafetyItemResult })}>{["PASS","FAIL","NOT_REPORTED","NOT_APPLICABLE"].map((value) => <option key={value} value={value}>{labelFor(value)}</option>)}</select>
          <Input className="lg:col-span-4" placeholder="Exact source finding" value={item.sourceDescription} onChange={(e) => updateFinding(item.id, { sourceDescription: e.target.value })} />
          <label className="flex items-center gap-2 text-[11px] lg:col-span-2"><input type="checkbox" checked={item.correctedBeforeCertificate} onChange={(e) => updateFinding(item.id, { correctedBeforeCertificate: e.target.checked })} />Corrected</label>
          <Button className="lg:col-span-1" variant="ghost" size="sm" onClick={() => setFindings((current) => current.filter((row) => row.id !== item.id))}>Remove</Button>
        </div>)}</div>
      </Card>

      <Card className="p-4"><Field label="Internal notes"><Textarea className={areaClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field><div className="mt-4 flex justify-end"><Button disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Safety Inspection"}</Button></div></Card>
    </main>

    <aside className="xl:sticky xl:top-4 xl:self-start"><Card className="overflow-hidden"><div className="grid grid-cols-3 border-b">{(["EVIDENCE","DETAILS","ACTIVITY"] as const).map((tab) => <button className={`px-2 py-3 text-[10px] font-bold ${sideTab === tab ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`} key={tab} onClick={() => setSideTab(tab)}>{tab}</button>)}</div><div className="p-4">
      {sideTab === "EVIDENCE" ? <div className="space-y-3"><div className={`rounded-lg border p-3 ${evidence.length ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}`}>{evidence.length ? <CheckCircle2 className="mb-2 size-5 text-emerald-600" /> : <AlertTriangle className="mb-2 size-5 text-amber-600" />}<p className="text-xs font-bold">{evidence.length ? `${evidence.length} source file${evidence.length === 1 ? "" : "s"} attached` : "Official evidence missing"}</p></div>{evidence.map((item) => <div className="flex gap-2 rounded-lg border p-2 text-xs" key={item.id}><FileText className="size-4 text-primary" /><span className="break-all">{item.fileName}</span></div>)}</div> : null}
      {sideTab === "DETAILS" ? <dl className="space-y-3 text-xs"><div><dt className="text-muted-foreground">Vehicle</dt><dd className="font-bold">{vehicle ? `Unit ${vehicle.unitNumber}` : "Not selected"}</dd></div><div><dt className="text-muted-foreground">Jurisdiction</dt><dd className="font-bold">{jurisdiction || "Not entered"}</dd></div><div><dt className="text-muted-foreground">Annual relationship</dt><dd className="font-bold">{annualRelationship}</dd></div><div><dt className="text-muted-foreground">Two-way links</dt><dd className="mt-1 flex items-center gap-1 font-bold text-primary"><Link2 className="size-3" />Vehicle · Registration · Repairs</dd></div></dl> : null}
      {sideTab === "ACTIVITY" ? <div className="space-y-3 text-xs"><div className="flex gap-2"><ShieldCheck className="size-4 text-primary" /><div><p className="font-bold">Draft opened</p><p className="text-muted-foreground">Awaiting validation and canonical save.</p></div></div><p className="rounded-lg bg-muted p-3 text-[11px] text-muted-foreground">Saving must create the normal TES audit event. This panel reads that activity after persistence.</p></div> : null}
    </div></Card></aside>
  </div>
}
