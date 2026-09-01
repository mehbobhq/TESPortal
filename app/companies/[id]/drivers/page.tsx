"use client"

import { use, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Plus, Search, UserPlus, Users } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { JURISDICTIONS } from "@/lib/jurisdictions"
import { recordAuditEvent } from "@/lib/audit-logger"
import type { DuplicateFinding } from "@/lib/duplicate-detection"
import {
  calculateAge,
  createDriver,
  currentAddress,
  currentLicence,
  findDriverDuplicate,
  fullLegalName,
  getCompany,
  loadCompanyDriverStore,
  loadDriverMasterStore,
  type CompanyDriverRelationship,
  type DriverInput,
  type DriverMaster,
  type DriverRole,
  type DriverStatus,
  type EmploymentStatus,
  type OperatingRegion,
  type RecordType,
} from "@/lib/driver-data"

const RECORD_TYPES: RecordType[] = [
  "Employee",
  "Owner-Operator",
  "Contractor",
  "Temporary Driver",
]

const REGIONS: OperatingRegion[] = ["Canada", "United States", "Cross-Border"]

const ROLES: DriverRole[] = [
  "Driver",
  "Driver / Trainer",
  "Trainer",
  "Safety Manager",
  "General Manager",
  "Owner",
  "Other",
]

const STATUSES: DriverStatus[] = [
  "Active",
  "On Leave",
  "Suspended",
  "Inactive",
  "Terminated",
]

const EMPLOYMENT: EmploymentStatus[] = [
  "Employed",
  "Self-Employed",
  "Contractor",
  "On Leave",
  "Inactive",
  "Terminated",
]

const COUNTRIES = ["Canada", "United States"] as const

const REVIEW_REASONS = [
  "Recently Relocated",
  "Licence Change Pending",
  "Temporary Residence",
  "Address Requires Correction",
  "Licence Information Requires Correction",
  "Other",
]

const emptyForm = (): DriverInput => {
  const today = new Date().toISOString().slice(0, 10)

  return {
    legalFirstName: "",
    legalMiddleName: "",
    legalLastName: "",
    preferredName: "",
    dateOfBirth: "",
    recordType: "Employee",
    operatingRegion: "Cross-Border",
    currentRole: "Driver",
    driverStatus: "Active",
    employmentStatus: "Employed",
    relationshipStartDate: today,
    relationshipEndDate: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateProvince: "",
    postalZip: "",
    country: "Canada",
    addressEffectiveFrom: today,
    licenceNumber: "",
    licenceJurisdiction: "",
    licenceCountry: "Canada",
    licenceClass: "",
    licenceEffectiveFrom: today,
  }
}

const tone = (status: DriverStatus) => {
  if (status === "Active") return "ok"
  if (status === "On Leave") return "warn"
  if (status === "Suspended" || status === "Terminated") return "danger"
  return "neutral"
}

type Row = {
  master: DriverMaster
  relationship: CompanyDriverRelationship
}

type ReviewState = {
  master: DriverMaster
  finding: DuplicateFinding
  form: DriverInput
}

export default function DriversPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: companyId } = use(params)
  const company = getCompany(companyId)

  const [rows, setRows] = useState<Row[]>([])
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("All")
  const [region, setRegion] = useState("All")
  const [type, setType] = useState("All")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<DriverInput>(emptyForm())
  const [error, setError] = useState("")
  const [review, setReview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [matchReview, setMatchReview] = useState<ReviewState | null>(null)
  const [ambiguousMatches, setAmbiguousMatches] = useState<DriverMaster[]>([])

  const hydrate = () => {
    const masters = loadDriverMasterStore().drivers
    const relationships = loadCompanyDriverStore(companyId).relationships.filter(
      (relationship) => !relationship.archive.isArchived,
    )

    const joined = relationships
      .map((relationship) => {
        const master = masters.find((item) => item.id === relationship.driverMasterId)
        return master ? { master, relationship } : null
      })
      .filter(Boolean) as Row[]

    setRows(joined)
  }

  useEffect(() => {
    hydrate()
  }, [companyId])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return rows.filter(({ master, relationship }) => {
      const licence = currentLicence(master)?.licenceNumber || ""
      const searchable = `${fullLegalName(master)} ${master.id} ${licence}`.toLowerCase()

      return (
        (!normalizedQuery || searchable.includes(normalizedQuery)) &&
        (status === "All" || relationship.driverStatus === status) &&
        (region === "All" || relationship.operatingRegion === region) &&
        (type === "All" || relationship.recordType === type)
      )
    })
  }, [rows, query, status, region, type])

  const setField = <K extends keyof DriverInput>(key: K, value: DriverInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const openAdd = () => {
    setError("")
    setAmbiguousMatches([])
    setMatchReview(null)
    setReview(false)
    setForm(emptyForm())
    setOpen(true)
  }

  const prepareCreate = () => {
    setError("")
    setAmbiguousMatches([])

    try {
      const mismatch =
        form.stateProvince.trim() &&
        form.licenceJurisdiction.trim() &&
        form.stateProvince.trim().toUpperCase() !== form.licenceJurisdiction.trim().toUpperCase()

      if (mismatch && (!form.jurisdictionReview?.reason || !form.jurisdictionReview.explanation.trim())) {
        setReview(true)
        setError("Residence and licence jurisdictions differ. Record the discrepancy before continuing.")
        return
      }

      const match = findDriverDuplicate(form, loadDriverMasterStore().drivers)

      if (match.kind === "AMBIGUOUS") {
        setAmbiguousMatches(match.drivers)
        setError("Multiple possible Driver Masters were found. Select a candidate only after human review; a new Driver Master cannot be created from an ambiguous match.")
        return
      }

      if (match.kind === "CLEAR") {
        setMatchReview({ master: match.driver, finding: match.finding, form })
        return
      }

      persistCreate()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to validate Driver.")
    }
  }

  const persistCreate = (confirmedDriverMasterId?: string) => {
    setSaving(true)
    setError("")

    try {
      const result = createDriver(companyId, form, {
        confirmedDriverMasterId,
      })

      if (!result.matchedExisting) {
        recordAuditEvent({
          actor: "",
          role: "",
          companyId,
          entityType: "Driver",
          entityId: result.master.id,
          action: "CREATE",
          details: `Created Driver Master ${result.master.id}.`,
        })
      }

      recordAuditEvent({
        actor: "",
        role: "",
        companyId,
        entityType: "Driver",
        entityId: result.master.id,
        action: "CREATE",
        details: `Created company Driver relationship ${result.relationship.id} for ${result.master.id}${result.matchedExisting ? " using an existing Driver Master" : ""}.`,
      })

      hydrate()
      setOpen(false)
      setMatchReview(null)
      setAmbiguousMatches([])
      setReview(false)
      setForm(emptyForm())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save Driver.")
    } finally {
      setSaving(false)
    }
  }

  if (!company) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Company not found</CardTitle>
        </CardHeader>
        <CardContent>
          The requested company is not present in the canonical Companies store.
        </CardContent>
      </Card>
    )
  }

  const openReviews = rows.filter(
    ({ master }) =>
      master.identityResolution.status === "REVIEW" ||
      master.jurisdictionReviews.some((item) => item.status === "OPEN") ||
      (master.identitySourceReviews || []).some((item) => item.status === "OPEN"),
  ).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Drivers"
        description="Driver compliance, qualification, identity and company relationship records."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled
              title="Applicant workflow is planned for a later phase."
            >
              <UserPlus data-icon="inline-start" />
              Invite Applicant
            </Button>
            <Button onClick={openAdd}>
              <Plus data-icon="inline-start" />
              Add Existing Driver
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Drivers"
          value={String(rows.length)}
          icon={Users}
          hint="company relationship roster"
        />
        <StatCard
          label="Active Drivers"
          value={String(rows.filter(({ relationship }) => relationship.driverStatus === "Active").length)}
          icon={Users}
          hint="currently active"
        />
        <StatCard
          label="Inactive / Terminated"
          value={String(rows.filter(({ relationship }) => ["Inactive", "Terminated"].includes(relationship.driverStatus)).length)}
          icon={Users}
          hint="not active"
        />
        <StatCard
          label="Open Reviews"
          value={String(openReviews)}
          icon={Users}
          hint="identity / jurisdiction"
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_180px]">
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, Driver ID, licence..."
              />
            </InputGroup>

            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option>All</option>
              {STATUSES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>

            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option>All</option>
              {RECORD_TYPES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>

            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
            >
              <option>All</option>
              {REGIONS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Company Driver Roster</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                  {[
                    "Driver",
                    "Driver Record ID",
                    "Current Role",
                    "Record Type",
                    "Operating Region",
                    "Licence",
                    "Status",
                    "Start Date",
                  ].map((item) => (
                    <th key={item} className="px-4 py-3">
                      {item}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="h-32 text-center text-muted-foreground">
                      No Driver records match the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map(({ master, relationship }) => {
                    const licence = currentLicence(master)

                    return (
                      <tr key={relationship.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <Link
                            href={`/companies/${companyId}/drivers/${master.id}`}
                            className="font-medium hover:text-primary"
                          >
                            {master.identity.preferredName || fullLegalName(master)}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {fullLegalName(master)} · Age {calculateAge(master.identity.dateOfBirth) ?? "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{master.id}</td>
                        <td className="px-4 py-3">{relationship.currentRole}</td>
                        <td className="px-4 py-3">{relationship.recordType}</td>
                        <td className="px-4 py-3">{relationship.operatingRegion}</td>
                        <td className="px-4 py-3 font-mono text-xs">{licence?.licenceNumber || "—"}</td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={tone(relationship.driverStatus) as any}>
                            {relationship.driverStatus}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3">{relationship.startDate}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl border bg-background shadow-2xl">
            <div className="sticky top-0 z-10 flex justify-between border-b bg-background px-5 py-4">
              <div>
                <h2 className="font-semibold">Add Existing Driver</h2>
                <p className="text-xs text-muted-foreground">
                  Creates or reuses a permanent Driver Master and creates the company relationship.
                </p>
              </div>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>

            <div className="space-y-5 p-5">
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {ambiguousMatches.length > 0 && (
                <section className="rounded-md border border-amber-300/60 bg-amber-50/50 p-4">
                  <div className="mb-2 font-medium">Possible existing Driver Masters</div>
                  <p className="mb-3 text-sm text-muted-foreground">
                    A new Driver Master cannot be created from an ambiguous identity result.
                    Review the candidates before deciding how to proceed.
                  </p>
                  <div className="space-y-2">
                    {ambiguousMatches.map((candidate) => (
                      <div key={candidate.id} className="rounded border bg-background p-3 text-sm">
                        <div className="font-medium">{fullLegalName(candidate)}</div>
                        <div className="text-xs text-muted-foreground">
                          {candidate.id} · DOB {candidate.identity.dateOfBirth}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <Section title="General Information">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <F l="Legal First Name *" v={form.legalFirstName} s={(value) => setField("legalFirstName", value)} />
                  <F l="Legal Middle Name" v={form.legalMiddleName} s={(value) => setField("legalMiddleName", value)} />
                  <F l="Legal Last Name *" v={form.legalLastName} s={(value) => setField("legalLastName", value)} />
                  <F l="Preferred Name" v={form.preferredName} s={(value) => setField("preferredName", value)} />
                  <F l="Date of Birth *" t="date" v={form.dateOfBirth} s={(value) => setField("dateOfBirth", value)} />
                </div>
              </Section>

              <Section title="Company Relationship">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <S l="Record Type *" v={form.recordType} o={RECORD_TYPES} s={(value) => setField("recordType", value as RecordType)} />
                  <S l="Operating Region *" v={form.operatingRegion} o={REGIONS} s={(value) => setField("operatingRegion", value as OperatingRegion)} />
                  <S l="Current Role *" v={form.currentRole} o={ROLES} s={(value) => setField("currentRole", value as DriverRole)} />
                  <S l="Driver Status *" v={form.driverStatus} o={STATUSES} s={(value) => setField("driverStatus", value as DriverStatus)} />
                  <S l="Employment Status *" v={form.employmentStatus} o={EMPLOYMENT} s={(value) => setField("employmentStatus", value as EmploymentStatus)} />
                  <F l="Start Date *" t="date" v={form.relationshipStartDate} s={(value) => setField("relationshipStartDate", value)} />
                  <F l="End Date" t="date" v={form.relationshipEndDate} s={(value) => setField("relationshipEndDate", value)} />
                </div>
              </Section>

              <Section title="Current Address">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <F l="Address *" v={form.addressLine1} s={(value) => setField("addressLine1", value)} />
                  <F l="Address Line 2" v={form.addressLine2} s={(value) => setField("addressLine2", value)} />
                  <F l="City *" v={form.city} s={(value) => setField("city", value)} />
                  <J l="State / Province *" v={form.stateProvince} s={(value) => setField("stateProvince", value)} />
                  <F l="Postal / ZIP *" v={form.postalZip} s={(value) => setField("postalZip", value)} />
                  <S l="Country *" v={form.country} o={[...COUNTRIES]} s={(value) => setField("country", value as DriverInput["country"])} />
                  <F l="Effective From *" t="date" v={form.addressEffectiveFrom} s={(value) => setField("addressEffectiveFrom", value)} />
                </div>
              </Section>

              <Section title="Current Driver Licence">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <F l="Licence Number *" v={form.licenceNumber} s={(value) => setField("licenceNumber", value)} />
                  <J l="State / Province *" v={form.licenceJurisdiction} s={(value) => setField("licenceJurisdiction", value)} />
                  <S l="Country *" v={form.licenceCountry} o={[...COUNTRIES]} s={(value) => setField("licenceCountry", value as DriverInput["licenceCountry"])} />
                  <F l="Class" v={form.licenceClass} s={(value) => setField("licenceClass", value)} />
                  <F l="Effective From *" t="date" v={form.licenceEffectiveFrom} s={(value) => setField("licenceEffectiveFrom", value)} />
                </div>
              </Section>

              {(review || (form.stateProvince && form.licenceJurisdiction && form.stateProvince !== form.licenceJurisdiction)) && (
                <Section title="Identity / Jurisdiction Review">
                  <div className="grid gap-3 md:grid-cols-3">
                    <S
                      l="Reason *"
                      v={form.jurisdictionReview?.reason || ""}
                      o={REVIEW_REASONS}
                      s={(value) =>
                        setForm((current) => ({
                          ...current,
                          jurisdictionReview: {
                            reason: value,
                            explanation: current.jurisdictionReview?.explanation || "",
                            expectedResolutionDate: current.jurisdictionReview?.expectedResolutionDate || "",
                          },
                        }))
                      }
                    />
                    <F
                      l="Expected Resolution Date"
                      t="date"
                      v={form.jurisdictionReview?.expectedResolutionDate || ""}
                      s={(value) =>
                        setForm((current) => ({
                          ...current,
                          jurisdictionReview: {
                            reason: current.jurisdictionReview?.reason || "Other",
                            explanation: current.jurisdictionReview?.explanation || "",
                            expectedResolutionDate: value,
                          },
                        }))
                      }
                    />
                    <F
                      l="Explanation *"
                      v={form.jurisdictionReview?.explanation || ""}
                      s={(value) =>
                        setForm((current) => ({
                          ...current,
                          jurisdictionReview: {
                            reason: current.jurisdictionReview?.reason || "Other",
                            explanation: value,
                            expectedResolutionDate: current.jurisdictionReview?.expectedResolutionDate || "",
                          },
                        }))
                      }
                    />
                  </div>
                </Section>
              )}

              <div className="flex justify-end gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpen(false)
                    setMatchReview(null)
                    setAmbiguousMatches([])
                    setForm(emptyForm())
                    setError("")
                  }}
                >
                  Cancel
                </Button>
                <Button disabled={saving} onClick={prepareCreate}>
                  {saving ? "Saving..." : "Continue"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {matchReview && (
        <ExistingDriverReview
          companyName={company.name}
          master={matchReview.master}
          form={matchReview.form}
          onCancel={() => setMatchReview(null)}
          onConfirm={() => {
            setMatchReview(null)
            persistCreate(matchReview.master.id)
          }}
        />
      )}
    </div>
  )
}

function ExistingDriverReview({
  companyName,
  master,
  form,
  onCancel,
  onConfirm,
}: {
  companyName: string
  master: DriverMaster
  form: DriverInput
  onCancel: () => void
  onConfirm: () => void
}) {
  const existingAddress = currentAddress(master)
  const existingLicence = currentLicence(master)
  const suppliedName = [form.legalFirstName, form.legalMiddleName, form.legalLastName]
    .filter(Boolean)
    .join(" ")

  const suppliedAddress = [
    form.addressLine1,
    form.city,
    form.stateProvince,
    form.postalZip,
    form.country,
  ]
    .filter(Boolean)
    .join(", ")

  const suppliedLicence = `${form.licenceNumber} · ${form.licenceJurisdiction} · ${form.licenceCountry}`
  const existingLicenceText = existingLicence
    ? `${existingLicence.licenceNumber} · ${existingLicence.jurisdiction} · ${existingLicence.country}`
    : "No current licence on Driver Master"
  const identityDiffers =
    suppliedName.trim().toLowerCase() !== fullLegalName(master).trim().toLowerCase() ||
    form.dateOfBirth !== master.identity.dateOfBirth
  const addressDiffers = Boolean(existingAddress) && suppliedAddress !== [
    existingAddress.addressLine1,
    existingAddress.city,
    existingAddress.stateProvince,
    existingAddress.postalZip,
    existingAddress.country,
  ].filter(Boolean).join(", ")
  const licenceDiffers = Boolean(existingLicence) && suppliedLicence !== existingLicenceText

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-background shadow-2xl">
        <div className="border-b px-5 py-4">
          <h2 className="font-semibold">Existing Driver Master Found</h2>
          <p className="text-sm text-muted-foreground">
            This company relationship will be linked to the existing permanent Driver Master for {companyName}.
          </p>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <ReadOnlyReview label="Driver Master ID" value={master.id} />
            <ReadOnlyReview label="Legal Name" value={fullLegalName(master)} />
            <ReadOnlyReview label="Date of Birth" value={master.identity.dateOfBirth} />
            <ReadOnlyReview
              label="Current Address"
              value={existingAddress ? `${existingAddress.addressLine1}, ${existingAddress.city}, ${existingAddress.stateProvince}` : "—"}
            />
            <ReadOnlyReview label="Current Licence" value={existingLicenceText} />
          </div>

          <div className="rounded-md border bg-muted/20 p-4">
            <div className="mb-3 text-sm font-semibold">Supplied information vs existing Driver Master</div>
            <div className="grid gap-3">
              <ComparisonRow
                label="Identity"
                existing={`${fullLegalName(master)} · DOB ${master.identity.dateOfBirth}`}
                supplied={`${suppliedName} · DOB ${form.dateOfBirth}`}
                differs={identityDiffers}
              />
              <ComparisonRow
                label="Address"
                existing={existingAddress ? [existingAddress.addressLine1, existingAddress.city, existingAddress.stateProvince, existingAddress.postalZip, existingAddress.country].filter(Boolean).join(", ") : "—"}
                supplied={suppliedAddress}
                differs={addressDiffers}
              />
              <ComparisonRow
                label="Driver Licence"
                existing={existingLicenceText}
                supplied={suppliedLicence}
                differs={licenceDiffers}
              />
            </div>
          </div>

          <div className="rounded-md border border-amber-300/60 bg-amber-50/50 p-4 text-sm">
            <div className="font-medium">Confirmation required</div>
            <p className="mt-1 text-muted-foreground">
              Linking the existing Driver will not automatically overwrite canonical identity, address, or licence history.
              Any conflicting supplied information will be retained as structured source review information.
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={onCancel}>
              Back to Review
            </Button>
            <Button onClick={onConfirm}>Link Existing Driver</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ComparisonRow({
  label,
  existing,
  supplied,
  differs,
}: {
  label: string
  existing: string
  supplied: string
  differs: boolean
}) {
  return (
    <div className="grid gap-2 md:grid-cols-[140px_1fr_1fr] text-sm">
      <div className="font-medium">{label}</div>
      <div>
        <div className="text-xs text-muted-foreground">Existing</div>
        <div>{existing || "—"}</div>
      </div>
      <div className={differs ? "rounded bg-amber-100/70 p-1.5 dark:bg-amber-950/30" : ""}>
        <div className="text-xs text-muted-foreground">Supplied</div>
        <div>{supplied || "—"}</div>
      </div>
    </div>
  )
}

function ReadOnlyReview({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value || "—"}</div>
    </div>
  )
}

function F({
  l,
  v,
  s,
  t = "text",
}: {
  l: string
  v: string
  s: (value: string) => void
  t?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{l}</span>
      <input
        type={t}
        value={v}
        onChange={(event) => s(event.target.value)}
        className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
      />
    </label>
  )
}

function S({
  l,
  v,
  o,
  s,
}: {
  l: string
  v: string
  o: readonly string[]
  s: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{l}</span>
      <select
        value={v}
        onChange={(event) => s(event.target.value)}
        className="h-9 rounded-md border bg-background px-3 text-sm"
      >
        {o.map((item) => (
          <option key={item}>{item}</option>
        ))}
      </select>
    </label>
  )
}

function J({
  l,
  v,
  s,
}: {
  l: string
  v: string
  s: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{l}</span>
      <select
        value={v}
        onChange={(event) => s(event.target.value)}
        className="h-9 rounded-md border bg-background px-3 text-sm"
      >
        <option value="">Select...</option>
        {JURISDICTIONS.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 border-t pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}
