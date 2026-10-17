"use client"

import React, { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Plus, Search, Upload, UserPlus, Users, X } from "lucide-react"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { JURISDICTIONS } from "@/lib/jurisdictions"
import { driverDateInputValue } from "@/lib/driver-date"
import { isUnavailable, userMessage, CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import { addExistingDriver, checkExistingDriver, createDriver, type CanonicalDriverRow, type CanonicalExistingDriverMatch, type CreateDriverPayload } from "./canonical-client"
import { RECORD_TYPE_FROM_UI, RECORD_TYPE_TO_UI, STATUS_FROM_UI, STATUS_TO_UI, fullName } from "./mapping"

/**
 * The ORIGINAL Driver Register and Add Driver modal (git 0e8e8c3^), restored over the canonical PostgreSQL drivers.
 * Canonical: name, email, phone, relationship type / status / driver number / dates, licence. Everything else in the original form
 * (middle and preferred name, date of birth, address, operating region, licence document) has no canonical home: the controls stay,
 * and entering a value refuses the save with the exact gap instead of dropping it.
 */

const RECORD_TYPES = ["Not Established", "Employee", "Owner-Operator", "Contractor", "Temporary Driver"]
const REGIONS = ["Not Established", "Canada", "United States", "Cross-Border"]
const STATUSES = ["Not Established", "Onboarding", "Active", "On Leave", "Suspended", "Inactive", "Terminated"]
const COUNTRIES = ["Canada", "United States"] as const
type Country = (typeof COUNTRIES)[number]

type FormState = {
  legalFirstName: string
  legalMiddleName: string
  legalLastName: string
  preferredName: string
  dateOfBirth: string
  phone: string
  email: string
  recordType: string
  operatingRegion: string
  driverStatus: string
  driverNumber: string
  relationshipStartDate: string
  relationshipEndDate: string
  addressLine1: string
  addressLine2: string
  city: string
  stateProvince: string
  postalZip: string
  country: Country
  addressEffectiveFrom: string
  licenceNumber: string
  licenceJurisdiction: string
  licenceCountry: Country
  licenceClass: string
  licenceEffectiveFrom: string
}
const empty = (): FormState => ({ legalFirstName: "", legalMiddleName: "", legalLastName: "", preferredName: "", dateOfBirth: "", phone: "", email: "", recordType: "Not Established", operatingRegion: "Not Established", driverStatus: "Not Established", driverNumber: "", relationshipStartDate: "", relationshipEndDate: "", addressLine1: "", addressLine2: "", city: "", stateProvince: "", postalZip: "", country: "Canada", addressEffectiveFrom: "", licenceNumber: "", licenceJurisdiction: "", licenceCountry: "Canada", licenceClass: "", licenceEffectiveFrom: "" })

const tone = (status: string) => (status === "ACTIVE" ? "ok" : status === "ONBOARDING" || status === "SUSPENDED" ? "warn" : status === "ENDED" ? "danger" : "neutral")
const hasMandatoryIdentityFields = (x: { legalFirstName: string; legalLastName: string; email: string; phone: string }) => Boolean(x.legalFirstName.trim() && x.legalLastName.trim() && x.email.trim() && x.phone.trim())
const identityKey = (x: FormState) => [x.legalFirstName, x.legalLastName, x.email, x.phone, x.licenceCountry, x.licenceJurisdiction, x.licenceNumber].map((v) => v.trim().toLowerCase()).join("|")

type CheckState = { key: string; licenceChecked: boolean; match: CanonicalExistingDriverMatch }
type Resolution = { kind: "NEW" } | { kind: "REUSE"; personId: string } | null

export function RestoredDriversRegister({
  company,
  drivers,
  error,
}: {
  company: { id: string; name: string; kind: string; status: string }
  drivers: CanonicalDriverRow[]
  error?: string | null
}) {
  const router = useRouter()
  const companyId = company.id
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("All")
  const [region, setRegion] = useState("All")
  const [type, setType] = useState("All")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(empty())
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const [licenceFile, setLicenceFile] = useState<File | null>(null)
  const [check, setCheck] = useState<CheckState | null>(null)
  const [resolution, setResolution] = useState<Resolution>(null)
  const [inviteNote, setInviteNote] = useState(false)

  const filtered = useMemo(
    () =>
      drivers.filter((row) => {
        const hay = `${fullName(row, "")} ${row.personId} ${row.driverNumber ?? ""} ${row.licence?.number ?? ""}`.toLowerCase()
        const uiStatus = STATUS_TO_UI[row.status]
        const uiType = RECORD_TYPE_TO_UI[row.relationshipType]
        return hay.includes(q.toLowerCase()) && (status === "All" || uiStatus === status) && (region === "All" || region === "Not Established") && (type === "All" || uiType === type)
      }),
    [drivers, q, status, region, type],
  )

  const update = (key: keyof FormState, value: string) => {
    const next = { ...form, [key]: value } as FormState
    if (key === "country") next.stateProvince = ""
    if (key === "licenceCountry") next.licenceJurisdiction = ""
    setForm(next)
    if (["legalFirstName", "legalLastName", "email", "phone", "licenceNumber", "licenceJurisdiction", "licenceCountry"].includes(key)) {
      setCheck(null)
      setResolution(null)
    }
  }
  const jurisdictions = (country: Country) =>
    JURISDICTIONS.filter((j: any) => String(j.country || j.countryName || "").toLowerCase().includes(country === "Canada" ? "canada" : "united") || String(j.countryCode || "").toUpperCase() === (country === "Canada" ? "CA" : "US"))

  const fieldsComplete = hasMandatoryIdentityFields(form)
  const checkFresh = Boolean(check) && check!.key === identityKey(form)
  const licenceEntered = Boolean(form.licenceNumber.trim() && form.licenceJurisdiction)

  const runCheck = async () => {
    setFormError("")
    if (!hasMandatoryIdentityFields(form)) {
      setFormError("Enter First Name, Last Name, Email and Phone before checking for an existing Driver.")
      return
    }
    try {
      const match: CanonicalExistingDriverMatch = licenceEntered
        ? await checkExistingDriver(companyId, { jurisdictionCountry: form.licenceCountry, jurisdictionRegion: form.licenceJurisdiction, licenceNumber: form.licenceNumber })
        : { found: false }
      setCheck({ key: identityKey(form), licenceChecked: licenceEntered, match })
      setResolution(null)
    } catch (e) {
      setCheck(null)
      setResolution(null)
      setFormError(userMessage(e, "Existing Driver check could not be completed."))
    }
  }

  /** Values the original form accepted that the canonical schema cannot store: refused as a whole, never dropped. */
  const notStorable = (): string[] => {
    const missing: string[] = []
    if (form.legalMiddleName.trim()) missing.push("middle name")
    if (form.preferredName.trim()) missing.push("preferred name")
    if (form.dateOfBirth.trim()) missing.push("date of birth")
    if (form.addressLine1.trim() || form.addressLine2.trim() || form.city.trim() || form.stateProvince || form.postalZip.trim() || form.addressEffectiveFrom.trim()) missing.push("address")
    if (form.operatingRegion !== "Not Established") missing.push("operating region")
    if (form.relationshipEndDate.trim()) missing.push("relationship end date (a new driver cannot start already ended)")
    if (!RECORD_TYPE_FROM_UI[form.recordType as keyof typeof RECORD_TYPE_FROM_UI]) missing.push(`record type "${form.recordType}" (choose Employee, Contractor or Owner-Operator)`)
    const canonicalStatus = STATUS_FROM_UI[form.driverStatus as keyof typeof STATUS_FROM_UI]
    if (!canonicalStatus || canonicalStatus === "ENDED") missing.push(`status "${form.driverStatus}" (choose Onboarding, Active or Suspended)`)
    return missing
  }

  const submit = async () => {
    setFormError("")
    if (!check || !checkFresh) {
      setFormError("Run “Check for Existing Driver” for the current First Name, Last Name, Email and Phone before saving.")
      return
    }
    if (check.match.found && check.match.scope === "OTHER_ORGANIZATION") {
      setFormError("This licence is already registered to a driver in TES, so it cannot be used to create another driver. Check the licence number.")
      return
    }
    const found = check.match.found && check.match.scope === "THIS_ORGANIZATION" ? check.match : null
    if (found && !resolution) {
      setFormError("An existing Driver may match. Select the matching Driver, or confirm this is a different person, before saving.")
      return
    }
    if (resolution?.kind === "REUSE" && (!found || found.personId !== resolution.personId || found.activeAtThisOrganization)) {
      setFormError("The selected Driver cannot be added to this company.")
      return
    }
    if (!form.relationshipStartDate.trim()) {
      setFormError("Relationship Start is required.")
      return
    }
    const missing = notStorable()
    if (missing.length) {
      setFormError(new CanonicalOperationUnavailableError("Saving this driver", `${missing.join("; ")} ${missing.length === 1 ? "cannot" : "cannot"} be saved: ${missing.length === 1 ? "it has" : "they have"} no canonical home or is not a canonical value. Nothing was saved; clear or change ${missing.length === 1 ? "it" : "them"} and save again`).message)
      return
    }
    setSaving(true)
    try {
      const relationshipType = RECORD_TYPE_FROM_UI[form.recordType as keyof typeof RECORD_TYPE_FROM_UI]!
      const driverStatus = STATUS_FROM_UI[form.driverStatus as keyof typeof STATUS_FROM_UI] as CreateDriverPayload["status"]
      const effectiveFrom = driverDateInputValue(form.relationshipStartDate)
      const driverNumber = form.driverNumber.trim() || undefined
      if (resolution?.kind === "REUSE") {
        await addExistingDriver(companyId, { personId: resolution.personId, relationshipType, status: driverStatus, driverNumber, effectiveFrom })
        close()
        router.push(`/companies/${companyId}/drivers/${resolution.personId}`)
      } else {
        const created = await createDriver(companyId, {
          givenName: form.legalFirstName.trim(),
          familyName: form.legalLastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          relationshipType,
          status: driverStatus,
          driverNumber,
          effectiveFrom,
          licence: licenceEntered
            ? { jurisdictionCountry: form.licenceCountry, jurisdictionRegion: form.licenceJurisdiction, licenceNumber: form.licenceNumber.trim(), licenceClass: form.licenceClass.trim() || undefined, effectiveFrom: driverDateInputValue(form.licenceEffectiveFrom) || effectiveFrom }
            : undefined,
        })
        close()
        router.push(`/companies/${companyId}/drivers/${created.personId}`)
      }
    } catch (e) {
      setFormError(userMessage(e, "Unable to save Driver."))
    } finally {
      setSaving(false)
    }
  }

  const close = () => {
    setOpen(false)
    setForm(empty())
    setLicenceFile(null)
    setCheck(null)
    setResolution(null)
    setFormError("")
  }

  // Only a driver this company already holds is shown in detail. A licence registered to another company's driver is reported
  // without any identifying detail (no name, no id, no counts) and cannot be linked or recreated from here.
  const matchedDriver = check?.match.found && check.match.scope === "THIS_ORGANIZATION" ? check.match : null
  const otherCompanyMatch = Boolean(check?.match.found && check.match.scope === "OTHER_ORGANIZATION")

  return (
    <div className="space-y-6">
      <CompanyWorkspaceHeader
        company={{ id: company.id, name: company.name, kind: company.kind ?? "Customer", status: company.status ?? "Active" }}
        section="Drivers"
        description="Driver compliance records"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setInviteNote(true)}>
              <UserPlus className="mr-2 size-4" />
              Invite Applicant
            </Button>
            <Button
              onClick={() => {
                setCheck(null)
                setResolution(null)
                setOpen(true)
              }}
            >
              <Plus className="mr-2 size-4" />
              Add Driver
            </Button>
          </div>
        }
      />
      {inviteNote ? (
        <div className="flex items-start justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          <span>Secure applicant invitation is intentionally not activated until the authenticated external application workflow is connected. Driver applications have no canonical domain yet, so no invitation was created or sent.</span>
          <button type="button" onClick={() => setInviteNote(false)} aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Driver Records" value={String(drivers.length)} icon={Users} />
        <StatCard label="Active" value={String(drivers.filter((x) => x.status === "ACTIVE").length)} icon={Users} />
        <StatCard label="Cross-Border" value="—" icon={Users} />
        <StatCard label="Needs Identity Review" value="—" icon={Users} />
      </div>
      <CanonicalUnavailable action="Cross-Border and Needs Identity Review counts" reason="operating region and identity-review status have no canonical home, so they are not counted (shown as —)" />
      <Card>
        <CardHeader>
          <CardTitle>Driver Register</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search name, Master ID, Record ID, licence" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={status} onChange={setStatus} options={["All", ...STATUSES]} />
            <Select value={region} onChange={setRegion} options={["All", ...REGIONS]} />
            <Select value={type} onChange={setType} options={["All", ...RECORD_TYPES]} />
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <Th>Driver</Th>
                  <Th>Company Record ID</Th>
                  <Th>Master ID</Th>
                  <Th>Record Type</Th>
                  <Th>Operating Region</Th>
                  <Th>Licence</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.relationshipId} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => router.push(`/companies/${companyId}/drivers/${row.personId}`)}>
                    <Td>
                      <div className="font-semibold">{fullName(row, row.personId)}</div>
                      <div className="text-xs text-muted-foreground">Age —</div>
                    </Td>
                    <Td>{row.driverNumber ?? row.relationshipId}</Td>
                    <Td className="font-mono text-xs">{row.personId}</Td>
                    <Td>{RECORD_TYPE_TO_UI[row.relationshipType]}</Td>
                    <Td>Not Established</Td>
                    <Td>{row.licence ? `${row.licence.jurisdictionRegion} · ${row.licence.licenceClass || "Class —"}` : "—"}</Td>
                    <Td>
                      <StatusBadge tone={tone(row.status)}>{STATUS_TO_UI[row.status]}</StatusBadge>
                    </Td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-muted-foreground">
                      No Driver records match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 md:p-8">
          <div className="w-full max-w-5xl rounded-xl bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b p-5">
              <div>
                <h2 className="text-xl font-semibold">Add Driver</h2>
                <p className="text-sm text-muted-foreground">Driver Licence first · identity review before creation</p>
              </div>
              <Button variant="ghost" size="icon" onClick={close}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="space-y-6 p-5">
              <section className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center gap-2 font-semibold">
                  <Upload className="size-4" />
                  Start with Driver Licence
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Upload the licence as source evidence. OCR/barcode extraction must use the shared TES OCR adapter when connected; this page never treats a filename as extracted data.</p>
                <Input className="mt-3" type="file" accept="image/*,.pdf" onChange={(e) => setLicenceFile(e.target.files?.[0] || null)} />
                {licenceFile && <p className="mt-2 text-xs">Selected: {licenceFile.name}</p>}
                <CanonicalUnavailable className="mt-2" action="Storing the licence document" reason="the approved evidence lifecycle has no driver evidence target, so the file is not uploaded or stored; key the licence fields below instead" />
              </section>
              <Section title="Identity">
                <Grid>
                  <Field label="First Name *" value={form.legalFirstName} onChange={(v) => update("legalFirstName", v)} />
                  <Field label="Middle Name" value={form.legalMiddleName} onChange={(v) => update("legalMiddleName", v)} />
                  <Field label="Last Name *" value={form.legalLastName} onChange={(v) => update("legalLastName", v)} />
                  <Field label="Preferred Name" value={form.preferredName} onChange={(v) => update("preferredName", v)} />
                  <Field label="Date of Birth" type="date" value={form.dateOfBirth} onChange={(v) => update("dateOfBirth", v)} />
                  <Field label="Phone *" value={form.phone} onChange={(v) => update("phone", v)} />
                  <Field label="Email *" type="email" value={form.email} onChange={(v) => update("email", v)} />
                </Grid>
                <CanonicalUnavailable className="mt-2" action="Middle name, preferred name and date of birth" reason="they have no canonical home; entering a value refuses the save" />
              </Section>
              <Section title="Company Driver Relationship">
                <Grid>
                  <SelectField label="Record Type" value={form.recordType} onChange={(v) => update("recordType", v)} options={RECORD_TYPES} />
                  <SelectField label="Operating Region" value={form.operatingRegion} onChange={(v) => update("operatingRegion", v)} options={REGIONS} />
                  <SelectField label="Driver Status" value={form.driverStatus} onChange={(v) => update("driverStatus", v)} options={STATUSES} />
                  <Field label="Driver Number" value={form.driverNumber} onChange={(v) => update("driverNumber", v)} />
                  <Field label="Relationship Start *" type="date" value={form.relationshipStartDate} onChange={(v) => update("relationshipStartDate", v)} />
                  <Field label="Relationship End" type="date" value={form.relationshipEndDate} onChange={(v) => update("relationshipEndDate", v)} />
                </Grid>
                <CanonicalUnavailable className="mt-2" action="Operating region, Temporary Driver, On Leave, Inactive and an end date on a new driver" reason="the canonical relationship stores type Employee / Contractor / Owner-Operator, status Onboarding / Active / Suspended (Terminated by ending a current relationship), a driver number and its dates" />
              </Section>
              <Section title="Current Address">
                <Grid>
                  <Field label="Address (not available yet)" disabled value={form.addressLine1} onChange={(v) => update("addressLine1", v)} />
                  <Field label="Address Line 2 (not available yet)" disabled value={form.addressLine2} onChange={(v) => update("addressLine2", v)} />
                  <Field label="City (not available yet)" disabled value={form.city} onChange={(v) => update("city", v)} />
                  <SelectField label="Country (not available yet)" disabled value={form.country} onChange={(v) => update("country", v as Country)} options={COUNTRIES} />
                  <SelectField label="State / Province (not available yet)" disabled value={form.stateProvince} onChange={(v) => update("stateProvince", v)} options={jurisdictions(form.country).map((j: any) => j.code || j.value || j.name)} />
                  <Field label="Postal / ZIP (not available yet)" disabled value={form.postalZip} onChange={(v) => update("postalZip", v)} />
                  <Field label="Address Effective From (not available yet)" type="date" disabled value={form.addressEffectiveFrom} onChange={(v) => update("addressEffectiveFrom", v)} />
                </Grid>
                <CanonicalUnavailable className="mt-2" action="Driver address" reason="there is no canonical driver address table (addresses are not part of migrations 0014/0021), so these fields are disabled and an address is never accepted or stored" />
              </Section>
              <Section title="Current Driver Licence">
                <Grid>
                  <SelectField label="Issuing Country" value={form.licenceCountry} onChange={(v) => update("licenceCountry", v as Country)} options={COUNTRIES} />
                  <SelectField label="Issuing Jurisdiction" value={form.licenceJurisdiction} onChange={(v) => update("licenceJurisdiction", v)} options={jurisdictions(form.licenceCountry).map((j: any) => j.code || j.value || j.name)} />
                  <Field label="Licence Number" value={form.licenceNumber} onChange={(v) => update("licenceNumber", v)} />
                  <Field label="Class" value={form.licenceClass} onChange={(v) => update("licenceClass", v)} />
                  <Field label="Licence Effective From" type="date" value={form.licenceEffectiveFrom} onChange={(v) => update("licenceEffectiveFrom", v)} />
                </Grid>
                <p className="mt-3 text-xs text-muted-foreground">Unexpected jurisdiction format should be reviewed, not treated as proof of invalidity. Authoritative verification remains separate.</p>
              </Section>
              {check && checkFresh && (
                <div className="rounded-md border p-4 text-sm" role="status">
                  {otherCompanyMatch ? (
                    <div className="space-y-1" data-testid="licence-registered-elsewhere">
                      <div className="font-semibold">This licence is already registered to a driver in TES.</div>
                      <p className="text-xs text-muted-foreground">No details about that driver are shown, and a driver cannot be created a second time with the same licence. Linking an existing driver across companies needs a verified identity-resolution step that does not exist yet, so it is not available. Check the licence number you entered.</p>
                    </div>
                  ) : !matchedDriver ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-medium">
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                        {check.licenceChecked ? "No existing driver holds this licence — proceeding will create a new driver record." : "No licence was entered, so no canonical identity signal could be checked — proceeding will create a new driver record."}
                      </div>
                      <p className="text-xs text-muted-foreground">The canonical identity signal is the driver licence (country + jurisdiction + number). Matching by name, email or phone has no canonical backing and was not performed.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="font-semibold">This company already has a Driver with this licence.</div>
                      <div className={`rounded-md border p-3 ${resolution?.kind === "REUSE" ? "border-primary bg-primary/5" : ""}`}>
                        <div className="font-medium">
                          {fullName(matchedDriver)} · <span className="font-mono text-xs">{matchedDriver.personId}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">Matched on driver licence</div>
                        {matchedDriver.activeAtThisOrganization ? (
                          <div className="mt-2 text-xs font-medium text-amber-700">Already an active Driver at this company — cannot be added again.</div>
                        ) : (
                          <Button className="mt-2" size="sm" variant={resolution?.kind === "REUSE" ? "default" : "outline"} onClick={() => setResolution({ kind: "REUSE", personId: matchedDriver.personId })}>
                            {resolution?.kind === "REUSE" ? "Selected — same person" : "This is the same person"}
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">A licence number identifies exactly one driver, so “this is a different person” is not possible for this licence: correct the licence entered above if it was mistyped.</p>
                      {resolution?.kind === "REUSE" && <div className="text-xs text-muted-foreground">Saving adds this company as a new relationship for the existing Driver. Identity details already on the Driver record are kept; values typed above are not written over them, and relationships at other companies are not changed.</div>}
                    </div>
                  )}
                </div>
              )}
              {formError && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{formError}</div>}
            </div>
            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-4 rounded-b-[inherit] border-t border-border bg-card px-6 py-4 shadow-sm">
              <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                Record is ready when required information is complete.
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button disabled={!fieldsComplete || saving} onClick={runCheck}>
                  Check for Existing Driver
                </Button>
                <Button disabled={saving || !checkFresh || otherCompanyMatch} onClick={submit}>
                  {saving ? "Saving…" : "Save Driver"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-medium">{children}</th>
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>
}
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select className="h-10 rounded-md border bg-background px-3 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((x) => (
        <option key={x}>{x}</option>
      ))}
    </select>
  )
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{children}</div>
}
function Field({ label, value, onChange, type = "text", disabled = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  const safeValue = type === "date" ? driverDateInputValue(value) : value
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type={type} value={safeValue} disabled={disabled} placeholder={type === "date" ? "YYYY-MM-DD" : undefined} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
function SelectField({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[]; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {options.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </div>
  )
}
