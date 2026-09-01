"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Edit2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/status-badge"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { JURISDICTIONS, getJurisdictionLabel } from "@/lib/jurisdictions"
import { recordAuditEvent } from "@/lib/audit-logger"
import {
  calculateAge,
  currentAddress,
  currentLicence,
  fullLegalName,
  getCompany,
  loadCompanyDriverStore,
  loadDriverMasterStore,
  updateAddress,
  updateMaster,
  updateRelationship,
  type CompanyDriverRelationship,
  type DriverMaster,
  type DriverRole,
  type DriverStatus,
  type EmploymentStatus,
  type OperatingRegion,
  type RecordType,
} from "@/lib/driver-data"

const TABS = [
  "Profile",
  "Qualifications & Licensing",
  "Documents",
  "Screening & Medical",
  "Training",
  "Performance & Events",
] as const

const RT: RecordType[] = [
  "Employee",
  "Owner-Operator",
  "Contractor",
  "Temporary Driver",
]

const RG: OperatingRegion[] = ["Canada", "United States", "Cross-Border"]

const RL: DriverRole[] = [
  "Driver",
  "Driver / Trainer",
  "Trainer",
  "Safety Manager",
  "General Manager",
  "Owner",
  "Other",
]

const ST: DriverStatus[] = [
  "Active",
  "On Leave",
  "Suspended",
  "Inactive",
  "Terminated",
]

const ES: EmploymentStatus[] = [
  "Employed",
  "Self-Employed",
  "Contractor",
  "On Leave",
  "Inactive",
  "Terminated",
]

export default function DriverPage({
  params,
}: {
  params: Promise<{ id: string; driverId: string }>
}) {
  const { id: companyId, driverId } = use(params)
  const company = getCompany(companyId)

  const [master, setMaster] = useState<DriverMaster | null>(null)
  const [relationship, setRelationship] =
    useState<CompanyDriverRelationship | null>(null)
  const [edit, setEdit] = useState(false)
  const [tab, setTab] = useState<(typeof TABS)[number]>("Profile")
  const [error, setError] = useState("")
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [addressDraft, setAddressDraft] = useState<Record<string, string>>({})

  const hydrate = () => {
    const nextMaster =
      loadDriverMasterStore().drivers.find((item) => item.id === driverId) ||
      null

    const nextRelationship =
      loadCompanyDriverStore(companyId).relationships.find(
        (item) =>
          item.driverMasterId === driverId && !item.archive.isArchived,
      ) || null

    setMaster(nextMaster)
    setRelationship(nextRelationship)

    if (nextMaster && nextRelationship) {
      const address = currentAddress(nextMaster)

      setDraft({
        first: nextMaster.identity.legalFirstName,
        middle: nextMaster.identity.legalMiddleName || "",
        last: nextMaster.identity.legalLastName,
        preferred: nextMaster.identity.preferredName || "",
        dob: nextMaster.identity.dateOfBirth,
        recordType: nextRelationship.recordType,
        region: nextRelationship.operatingRegion,
        role: nextRelationship.currentRole,
        status: nextRelationship.driverStatus,
        employment: nextRelationship.employmentStatus,
        start: nextRelationship.startDate,
        end: nextRelationship.endDate || "",
      })

      if (address) {
        setAddressDraft({
          line1: address.addressLine1,
          line2: address.addressLine2 || "",
          city: address.city,
          state: address.stateProvince,
          zip: address.postalZip,
          country: address.country,
          effective: address.effectiveFrom,
        })
      }
    }
  }

  useEffect(() => {
    hydrate()
  }, [companyId, driverId])

  if (!company || !master || !relationship) {
    return (
      <div className="space-y-4">
        <Link
          href={`/companies/${companyId}/drivers`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Drivers
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>Driver unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            The Driver Master or active company relationship could not be
            found.
          </CardContent>
        </Card>
      </div>
    )
  }

  const address = currentAddress(master)
  const licence = currentLicence(master)

  const save = () => {
    setError("")

    try {
      if (
        draft.first !== master.identity.legalFirstName ||
        draft.middle !== (master.identity.legalMiddleName || "") ||
        draft.last !== master.identity.legalLastName ||
        draft.preferred !== (master.identity.preferredName || "") ||
        draft.dob !== master.identity.dateOfBirth
      ) {
        updateMaster(driverId, {
          legalFirstName: draft.first,
          legalMiddleName: draft.middle || undefined,
          legalLastName: draft.last,
          preferredName: draft.preferred || undefined,
          dateOfBirth: draft.dob,
        })

        recordAuditEvent({
          actor: "System Administrator",
          role: "Compliance Administrator",
          companyId,
          entityType: "Driver",
          entityId: driverId,
          action: "UPDATE",
          details: `Updated Driver Master profile ${driverId}.`,
        })
      }

      if (
        draft.recordType !== relationship.recordType ||
        draft.region !== relationship.operatingRegion ||
        draft.role !== relationship.currentRole ||
        draft.status !== relationship.driverStatus ||
        draft.employment !== relationship.employmentStatus ||
        draft.start !== relationship.startDate ||
        draft.end !== (relationship.endDate || "")
      ) {
        updateRelationship(companyId, driverId, {
          recordType: draft.recordType as RecordType,
          operatingRegion: draft.region as OperatingRegion,
          currentRole: draft.role as DriverRole,
          driverStatus: draft.status as DriverStatus,
          employmentStatus: draft.employment as EmploymentStatus,
          startDate: draft.start,
          endDate: draft.end || undefined,
        })

        recordAuditEvent({
          actor: "System Administrator",
          role: "Compliance Administrator",
          companyId,
          entityType: "Driver",
          entityId: driverId,
          action: "UPDATE",
          details: `Updated company Driver relationship ${relationship.id}.`,
        })
      }

      if (
        address &&
        (addressDraft.line1 !== address.addressLine1 ||
          addressDraft.line2 !== (address.addressLine2 || "") ||
          addressDraft.city !== address.city ||
          addressDraft.state !== address.stateProvince ||
          addressDraft.zip !== address.postalZip ||
          addressDraft.country !== address.country ||
          addressDraft.effective !== address.effectiveFrom)
      ) {
        updateAddress(driverId, {
          addressLine1: addressDraft.line1,
          addressLine2: addressDraft.line2 || undefined,
          city: addressDraft.city,
          stateProvince: addressDraft.state,
          postalZip: addressDraft.zip,
          country: addressDraft.country as any,
          effectiveFrom: addressDraft.effective,
        })

        recordAuditEvent({
          actor: "System Administrator",
          role: "Compliance Administrator",
          companyId,
          entityType: "Driver",
          entityId: driverId,
          action: "UPDATE",
          details: `Added effective-dated Driver address ${driverId}.`,
        })
      }

      hydrate()
      setEdit(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save Driver.")
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href={`/companies/${companyId}/drivers`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
          Drivers
        </Link>

        {!edit && tab === "Profile" ? (
          <Button variant="outline" onClick={() => setEdit(true)}>
            <Edit2 data-icon="inline-start" />
            Edit
          </Button>
        ) : edit && tab === "Profile" ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                hydrate()
                setEdit(false)
              }}
            >
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </div>
        ) : null}
      </div>

      <div>
        <h1 className="text-2xl font-semibold">
          {master.identity.preferredName || fullLegalName(master)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {master.id} · {company.name}
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((item) => (
          <button
            key={item}
            onClick={() => {
              setTab(item)
              setEdit(false)
            }}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${
              tab === item
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {tab !== "Profile" ? (
        <Card>
          <CardContent className="flex min-h-48 items-center justify-center p-8 text-sm text-muted-foreground">
            {tab} is not yet implemented in Phase 1.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Section title="General Information">
            {edit ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <F
                  l="Legal First Name"
                  v={draft.first}
                  s={(value) => setDraft({ ...draft, first: value })}
                />
                <F
                  l="Legal Middle Name"
                  v={draft.middle}
                  s={(value) => setDraft({ ...draft, middle: value })}
                />
                <F
                  l="Legal Last Name"
                  v={draft.last}
                  s={(value) => setDraft({ ...draft, last: value })}
                />
                <F
                  l="Preferred Name"
                  v={draft.preferred}
                  s={(value) => setDraft({ ...draft, preferred: value })}
                />
                <F
                  l="Date of Birth"
                  t="date"
                  v={draft.dob}
                  s={(value) => setDraft({ ...draft, dob: value })}
                />
                <R l="Driver Record ID" v={master.id} />
                <R
                  l="Age"
                  v={String(calculateAge(master.identity.dateOfBirth) ?? "—")}
                />
                <S
                  l="Record Type"
                  v={draft.recordType}
                  o={RT}
                  s={(value) => setDraft({ ...draft, recordType: value })}
                />
                <S
                  l="Operating Region"
                  v={draft.region}
                  o={RG}
                  s={(value) => setDraft({ ...draft, region: value })}
                />
                <S
                  l="Current Role"
                  v={draft.role}
                  o={RL}
                  s={(value) => setDraft({ ...draft, role: value })}
                />
                <S
                  l="Driver Status"
                  v={draft.status}
                  o={ST}
                  s={(value) => setDraft({ ...draft, status: value })}
                />
                <S
                  l="Employment Status"
                  v={draft.employment}
                  o={ES}
                  s={(value) => setDraft({ ...draft, employment: value })}
                />
                <F
                  l="Start Date"
                  t="date"
                  v={draft.start}
                  s={(value) => setDraft({ ...draft, start: value })}
                />
                <F
                  l="End Date"
                  t="date"
                  v={draft.end}
                  s={(value) => setDraft({ ...draft, end: value })}
                />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <R l="Driver Record ID" v={master.id} />
                <R l="Legal Name" v={fullLegalName(master)} />
                <R
                  l="Preferred Name"
                  v={master.identity.preferredName || "—"}
                />
                <R l="Date of Birth" v={master.identity.dateOfBirth} />
                <R
                  l="Age"
                  v={String(calculateAge(master.identity.dateOfBirth) ?? "—")}
                />
                <R l="Record Type" v={relationship.recordType} />
                <R l="Operating Region" v={relationship.operatingRegion} />
                <R l="Current Role" v={relationship.currentRole} />
                <R
                  l="Driver Status"
                  v={
                    <StatusBadge
                      tone={
                        relationship.driverStatus === "Active"
                          ? "ok"
                          : relationship.driverStatus === "On Leave"
                            ? "warn"
                            : relationship.driverStatus === "Suspended" ||
                                relationship.driverStatus === "Terminated"
                              ? "danger"
                              : "neutral"
                      }
                    >
                      {relationship.driverStatus}
                    </StatusBadge>
                  }
                />
                <R
                  l="Employment Status"
                  v={relationship.employmentStatus}
                />
                <R l="Start Date" v={relationship.startDate} />
                <R l="End Date" v={relationship.endDate || "Current"} />
              </div>
            )}
          </Section>

          <Section title="Current Address">
            {edit ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <F
                  l="Address"
                  v={addressDraft.line1 || ""}
                  s={(value) => setAddressDraft({ ...addressDraft, line1: value })}
                />
                <F
                  l="Address Line 2"
                  v={addressDraft.line2 || ""}
                  s={(value) => setAddressDraft({ ...addressDraft, line2: value })}
                />
                <F
                  l="City"
                  v={addressDraft.city || ""}
                  s={(value) => setAddressDraft({ ...addressDraft, city: value })}
                />
                <J
                  l="State / Province"
                  v={addressDraft.state || ""}
                  s={(value) => setAddressDraft({ ...addressDraft, state: value })}
                />
                <F
                  l="Postal / ZIP"
                  v={addressDraft.zip || ""}
                  s={(value) => setAddressDraft({ ...addressDraft, zip: value })}
                />
                <S
                  l="Country"
                  v={addressDraft.country || "Canada"}
                  o={["Canada", "United States"]}
                  s={(value) =>
                    setAddressDraft({ ...addressDraft, country: value })
                  }
                />
                <F
                  l="Effective From"
                  t="date"
                  v={addressDraft.effective || ""}
                  s={(value) =>
                    setAddressDraft({ ...addressDraft, effective: value })
                  }
                />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <R l="Address" v={address?.addressLine1 || "—"} />
                <R l="Address Line 2" v={address?.addressLine2 || "—"} />
                <R l="City" v={address?.city || "—"} />
                <R
                  l="State / Province"
                  v={address ? getJurisdictionLabel(address.stateProvince) : "—"}
                />
                <R l="Postal / ZIP" v={address?.postalZip || "—"} />
                <R l="Country" v={address?.country || "—"} />
                <R
                  l="Effective From"
                  v={address?.effectiveFrom || "—"}
                />
              </div>
            )}
          </Section>

          <Section title="Current Driver Licence">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <R l="Licence Number" v={licence?.licenceNumber || "—"} />
              <R
                l="State / Province"
                v={
                  licence
                    ? getJurisdictionLabel(licence.jurisdiction)
                    : "—"
                }
              />
              <R l="Country" v={licence?.country || "—"} />
              <R l="Class" v={licence?.class || "—"} />
            </div>
          </Section>

          <Section title="Relationship / Role History">
            <H
              rows={relationship.roleHistory.map((item) => [
                item.id,
                item.role,
                item.effectiveFrom,
                item.effectiveTo || "Current",
              ])}
            />
          </Section>

          <Section title="Status History">
            <H
              rows={relationship.statusHistory.map((item) => [
                item.id,
                item.statusValue,
                item.effectiveFrom,
                item.effectiveTo || "Current",
              ])}
            />
          </Section>

          <Section title="Address History">
            <H
              rows={master.addressHistory.map((item) => [
                item.id,
                `${item.city}, ${getJurisdictionLabel(item.stateProvince)}`,
                item.effectiveFrom,
                item.effectiveTo || "Current",
              ])}
            />
          </Section>

          <Section title="Identity / Jurisdiction Review">
            {master.jurisdictionReviews.filter((item) => item.status === "OPEN")
              .length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open identity or jurisdiction review.
              </p>
            ) : (
              master.jurisdictionReviews
                .filter((item) => item.status === "OPEN")
                .map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-amber-300/60 bg-amber-50/50 p-3"
                  >
                    <div className="font-medium">{item.reason}</div>
                    <p className="text-sm text-muted-foreground">
                      {item.explanation}
                    </p>
                    {item.expectedResolutionDate && (
                      <p className="text-xs text-muted-foreground">
                        Expected resolution: {item.expectedResolutionDate}
                      </p>
                    )}
                  </div>
                ))
            )}
          </Section>
        </div>
      )}
    </div>
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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wide">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
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
  s: (v: string) => void
  t?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{l}</span>
      <input
        type={t}
        value={v}
        onChange={(e) => s(e.target.value)}
        className="h-9 rounded-md border bg-background px-3 text-sm"
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
  s: (v: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{l}</span>
      <select
        value={v}
        onChange={(e) => s(e.target.value)}
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
  s: (v: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{l}</span>
      <select
        value={v}
        onChange={(e) => s(e.target.value)}
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

function R({
  l,
  v,
}: {
  l: string
  v: React.ReactNode
}) {
  return <ReadOnlyField label={l} value={v as any} />
}

function H({ rows }: { rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2">Record</th>
            <th>Value</th>
            <th>Effective From</th>
            <th>Effective To</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item[0]} className="border-b last:border-0">
              <td className="py-2 font-mono text-xs">{item[0]}</td>
              <td className="font-medium">{item[1]}</td>
              <td>{item[2]}</td>
              <td>{item[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
