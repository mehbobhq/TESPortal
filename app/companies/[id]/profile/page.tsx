"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Building2, MapPin, RefreshCw, History, Lock } from "lucide-react"

import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { LoadingState, EmptyState } from "@/src/components/shared/StateDisplays"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { CompanyActivityPanel } from "@/src/components/company/CompanyActivityPanel"

type SectionState = "ok" | "not_permitted"

type ServiceTypeState =
  | { state: "contracted"; packages: string[]; contractReference: string | null }
  | { state: "not_contracted" }
  | { state: "restricted" }

const STAGE_LABEL: Record<string, string> = {
  ONBOARDING: "Onboarding",
  TRIAL: "Trial",
  ACTIVE: "Active",
  MANAGED_PROBATION: "Managed probation",
  SUSPENDED: "Suspended",
  ENDED: "Ended",
}

type CompanyProfile = {
  id: string
  name: string
  legalName: string
  kind: string
  region: string
  status: string
  createdAt: string
  dba: string | null
  contact: string | null
  contactPersonId: string | null
  phone: string | null
  email: string | null
  billingEmail: string | null
  website: string | null
  cargoTypes: string[]
  gpsProvider: string | null
  fuelProvider: string | null
  payMethod: string | null
  serviceType: ServiceTypeState | null
  assessment: { state: "not_yet_assessed" }
  engagements: Array<{ id: string; startedAt: string; endedAt: string | null; current: boolean }>
  eldProvider: string | null
  endDate: string | null
  opRegion: "Canada Only" | "US Only" | "Cross-Border" | null
  incorpNo: string | null
  businessNo: string | null
  ein: string | null
  gstHst: string | null
  regCorpState: string | null
  regCorpCountry: string | null
  usdot: string | null
  mc: string | null
  nsc: string | null
  mvid: string | null
  scac: string | null
  carrierCode: string | null
  accIrp: string | null
  accIfta: string | null
  accNyhut: string | null
  accNm: string | null
  accKyu: string | null
  accOr: string | null
  accCt: string | null
  startDate: string | null
  serviceStage: string | null
  reg_street: string | null
  reg_city: string | null
  reg_state: string | null
  reg_zip: string | null
  reg_country: string | null
  mail_street: string | null
  mail_city: string | null
  mail_state: string | null
  mail_zip: string | null
  mail_country: string | null
  yard_street: string | null
  yard_city: string | null
  yard_state: string | null
  yard_zip: string | null
  yard_country: string | null
  sections: Record<"identity" | "operatingProfile" | "customer" | "locations" | "contacts" | "authorities" | "registrations" | "contracts", SectionState>
  editAccess: { identity: boolean }
  customerDetails: {
    authorities:
      | { state: "ok"; serviceDecisionAuthority: { personId: string; name: string | null; since: string } | null; contractSignatory: { personId: string; name: string | null; since: string } | null; samePerson: boolean | null }
      | { state: "restricted" }
    contracts: { state: "ok"; byStatus: Record<string, number>; signedInForce: boolean; signedReference: string | null } | { state: "restricted" }
  } | null
  addressHistory: Array<{ role: "REGISTERED" | "MAILING" | "HOME_YARD"; address: string; from: string; to: string | null }> | null
  paymentMethodHistory: Array<{ method: string; from: string; to: string | null }> | null
  notRecordedYet: string[]
}

const ROLE_LABEL = { REGISTERED: "Registered", MAILING: "Mailing", HOME_YARD: "Yard / home terminal" } as const

const workspace = (id: string, name: string) => `/companies/${encodeURIComponent(id)}/${name}`

const Card = ({ title, icon, children, action }: { title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) => (
  <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
    <header className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </h3>
      {action}
    </header>
    <div className="p-4">{children}</div>
  </section>
)

const ManageLink = ({ href, label }: { href: string; label: string }) => (
  <Link href={href} className="text-[11px] font-semibold text-primary hover:underline">
    {label}
  </Link>
)

export default function CompanyProfilePage() {
  const params = useParams()
  const id = typeof params?.id === "string" ? params.id : undefined
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Real counts from the canonical lists. null = not loaded, "denied" = not permitted.
  const [fleet, setFleet] = useState<{ trucks: number; trailers: number; drivers: number } | "denied" | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((key) => key + 1)
  }, [])

  useEffect(() => {
    if (!id) {
      setCompany(null)
      setLoading(false)
      return
    }
    let cancelled = false
    fetch(`/api/companies/${encodeURIComponent(id)}/profile`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) return { company: null }
        if (!response.ok) throw new Error("Unable to load company profile.")
        return response.json() as Promise<{ company: CompanyProfile | null }>
      })
      .then((payload) => {
        if (!cancelled) {
          setCompany(payload.company)
          setError(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCompany(null)
          setError("The company profile could not be loaded. This is a temporary or permission problem, not a missing company.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([
      fetch(`/api/companies/${encodeURIComponent(id)}/vehicles`, { cache: "no-store" }),
      fetch(`/api/companies/${encodeURIComponent(id)}/drivers`, { cache: "no-store" }),
    ])
      .then(async ([vehicles, drivers]) => {
        if (cancelled) return
        if (!vehicles.ok || !drivers.ok) return setFleet("denied")
        const v = ((await vehicles.json()).vehicles ?? []) as Array<{ vehicleType?: string; effectiveTo?: string | null }>
        const d = ((await drivers.json()).drivers ?? []) as Array<{ effectiveTo?: string | null }>
        const open = v.filter((item) => !item.effectiveTo)
        setFleet({
          trailers: open.filter((item) => item.vehicleType === "TRAILER").length,
          trucks: open.filter((item) => item.vehicleType === "TRUCK_TRACTOR" || item.vehicleType === "STRAIGHT_TRUCK").length,
          drivers: d.filter((item) => !item.effectiveTo).length,
        })
      })
      .catch(() => !cancelled && setFleet("denied"))
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="p-10" aria-busy="true">
        <LoadingState message="Loading company profile..." />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
        <EmptyState
          icon={<Building2 className="size-10 text-muted-foreground/60" />}
          title={error ? "Company Profile Unavailable" : "Company Not Found"}
          description={error ?? "The requested company record could not be found in the PostgreSQL directory."}
          action={
            error
              ? { label: "Try again", onClick: reload, icon: <RefreshCw className="size-4" /> }
              : { label: "Back to Directory", onClick: () => (window.location.href = "/companies"), icon: <ArrowLeft className="size-4" /> }
          }
        />
      </div>
    )
  }

  // --- visibility ---
  const isCustomer = company.kind === "Customer"
  // The recorded operating region decides which jurisdiction-specific sections are shown; when none is recorded, show all.
  const opRegion = company.opRegion
  const isCanada = opRegion === null || opRegion === "Canada Only" || opRegion === "Cross-Border"
  const isUS = opRegion === null || opRegion === "US Only" || opRegion === "Cross-Border"
  const showCustoms = opRegion === null || opRegion === "Cross-Border" || Boolean(company.scac || company.carrierCode)
  const stageLabel = company.serviceStage ? (STAGE_LABEL[company.serviceStage] ?? company.serviceStage) : null
  const serviceTypeText = (() => {
    const state = company.serviceType
    if (!state) return null
    if (state.state === "restricted") return "Not permitted to view"
    if (state.state === "not_contracted") return "Not contracted"
    return state.packages.length > 0 ? state.packages.join(", ") : "Contracted (no package recorded)"
  })()
  const withheld = (section: keyof CompanyProfile["sections"]) => company.sections[section] === "not_permitted"
  const RESTRICTED = "Not permitted to view"

  const formatAddress = (prefix: "reg" | "mail" | "yard") => {
    const street = company[`${prefix}_street`]
    const city = company[`${prefix}_city`]
    const state = company[`${prefix}_state`]
    const zip = company[`${prefix}_zip`]
    const country = company[`${prefix}_country`]

    if (withheld("locations")) return <p className="text-sm font-medium text-muted-foreground">{RESTRICTED}</p>
    if (!street && !city && !state) return <p className="text-sm font-medium text-muted-foreground">Not recorded</p>
    return (
      <div className="text-sm font-medium leading-snug">
        {street}
        <br />
        {city && state ? `${city}, ${state}${zip ? ` ${zip}` : ""}` : ""}
        <br />
        {country}
      </div>
    )
  }

  const contracts = company.customerDetails?.contracts
  const authorities = company.customerDetails?.authorities
  const holderText = (holder: { name: string | null } | null) => (holder ? (holder.name ?? "Assigned (name not permitted to view)") : "None assigned")
  const contractText =
    contracts?.state === "ok"
      ? Object.entries(contracts.byStatus).map(([status, count]) => `${count} ${status.replace(/_/g, " ")}`).join(", ") || "No contracts"
      : contracts?.state === "restricted"
        ? RESTRICTED
        : null

  const canEdit = company.editAccess?.identity === true
  const profileActions = canEdit ? (
    <Link
      href={workspace(company.id, "edit")}
      className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs transition-colors hover:bg-muted"
    >
      Edit
    </Link>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground" title="You do not have permission to edit company records.">
      <Lock className="size-3" /> View only
    </span>
  )

  return (
    <div className="flex flex-col gap-4 pb-10">
      <CompanyWorkspaceHeader company={company} section="Profile" actions={profileActions} />

      {/* 1. RECORD SUMMARY (values read from PostgreSQL; nothing here is estimated) */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm sm:gap-x-8">
          {[
            ["Operating Region", withheld("operatingProfile") ? RESTRICTED : (company.opRegion ?? "Not recorded")],
            ["Registered In", company.region],
            ["Record Status", company.status],
            ["Record Created", company.createdAt ? new Date(company.createdAt).toISOString().split("T")[0] : "Unknown"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="mb-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
          {([["Trucks", "trucks"], ["Trailers", "trailers"], ["Drivers", "drivers"]] as const).map(([label, key]) => (
            <div key={key}>
              <dt className="mb-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
              <dd className="font-medium">{fleet === null ? "…" : fleet === "denied" ? RESTRICTED : fleet[key]}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* 2. MAIN GRID */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card title="Company Information" icon={<Building2 className="size-4 text-muted-foreground" />} action={canEdit ? <ManageLink href={workspace(company.id, "edit")} label="Edit" /> : undefined}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ReadOnlyField label="Company Name" value={company.name} subtext={company.legalName && company.legalName !== company.name ? `Registered legal name: ${company.legalName}` : undefined} />
              <ReadOnlyField label="Company Record Type" value={company.kind} />
              <ReadOnlyField label="DBA" value={company.dba} />
              <ReadOnlyField label="Phone" value={withheld("contacts") ? RESTRICTED : company.phone} />
              <ReadOnlyField label="Website" value={withheld("contacts") ? RESTRICTED : company.website} />
              <ReadOnlyField label="Account Email" value={withheld("contacts") ? RESTRICTED : company.email} />
              <ReadOnlyField label="Billing Email" value={withheld("contacts") ? RESTRICTED : company.billingEmail} />
              {company.contact && company.contactPersonId && !withheld("contacts") ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Primary Contact</span>
                  <Link
                    href={`/companies/${company.id}/contacts?person=${company.contactPersonId}`}
                    className="min-h-[1.5rem] break-words text-sm font-semibold text-primary hover:underline"
                    title="Open this person in Contacts"
                  >
                    {company.contact}
                  </Link>
                </div>
              ) : (
                <ReadOnlyField label="Primary Contact" value={withheld("contacts") ? RESTRICTED : company.contact} />
              )}
            </div>
          </Card>

          <Card title="Address Information" icon={<MapPin className="size-4 text-muted-foreground" />} action={canEdit ? <ManageLink href={workspace(company.id, "edit")} label="Edit" /> : undefined}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Registered Address</p>
                {formatAddress("reg")}
              </div>
              {isCustomer && (
                <>
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mailing Address</p>
                    {formatAddress("mail")}
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Yard Address</p>
                    {formatAddress("yard")}
                  </div>
                </>
              )}
            </div>
            {company.addressHistory && company.addressHistory.length > 0 && (
              <details className="mt-4 border-t border-border pt-3">
                <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
                  <History className="size-3.5" /> Previous addresses ({company.addressHistory.length})
                </summary>
                <ul className="mt-2 divide-y divide-border text-xs">
                  {company.addressHistory.map((entry, index) => (
                    <li key={`${entry.role}-${entry.from}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
                      <span><span className="font-semibold">{ROLE_LABEL[entry.role]}:</span> {entry.address}</span>
                      <span className="text-muted-foreground">{entry.from} to {entry.to ?? "now"}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          {isCustomer && (
            <Card title="Customer Information">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <ReadOnlyField label="Service Type" value={serviceTypeText} subtext="From the signed contract" />
                <ReadOnlyField label="Service Status" value={withheld("customer") ? RESTRICTED : stageLabel} />
                <ReadOnlyField label="Service Start Date" value={withheld("customer") ? RESTRICTED : company.startDate} />
                <ReadOnlyField label="Service End Date" value={withheld("customer") ? RESTRICTED : company.endDate} />
                {!withheld("customer") && company.engagements.length > 1 && (
                  <ReadOnlyField
                    label="Previous Engagements"
                    value={company.engagements.filter((engagement) => !engagement.current).map((engagement) => `${engagement.startedAt} to ${engagement.endedAt ?? "open"}`).join("; ")}
                  />
                )}
                <ReadOnlyField label="Contracts" value={contractText} subtext={contracts?.state === "ok" && contracts.signedReference ? `Signed: ${contracts.signedReference}` : undefined} />
                <ReadOnlyField
                  label="Service Decision Authority"
                  value={authorities?.state === "ok" ? holderText(authorities.serviceDecisionAuthority) : authorities?.state === "restricted" ? RESTRICTED : null}
                  subtext={authorities?.state === "ok" && authorities.serviceDecisionAuthority ? `Since ${authorities.serviceDecisionAuthority.since}` : undefined}
                />
                <ReadOnlyField
                  label="Contract Signatory"
                  value={authorities?.state === "ok" ? holderText(authorities.contractSignatory) : authorities?.state === "restricted" ? RESTRICTED : null}
                  subtext={authorities?.state === "ok" ? (authorities.samePerson ? "Same person as the Service Decision Authority" : authorities.contractSignatory ? `Since ${authorities.contractSignatory.since}` : undefined) : undefined}
                />
                <ReadOnlyField label="Preferred Payment Method" value={withheld("customer") ? RESTRICTED : company.payMethod} subtext="A billing preference only" />
                <ReadOnlyField label="Cargo Information" value={withheld("operatingProfile") ? RESTRICTED : company.cargoTypes.length > 0 ? company.cargoTypes.join(", ") : null} />
              </div>
              {company.paymentMethodHistory && company.paymentMethodHistory.length > 0 && (
                <details className="mt-4 border-t border-border pt-3">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
                    <History className="size-3.5" /> Previous payment methods ({company.paymentMethodHistory.length})
                  </summary>
                  <ul className="mt-2 divide-y divide-border text-xs">
                    {company.paymentMethodHistory.map((entry, index) => (
                      <li key={`${entry.method}-${entry.from}-${index}`} className="flex flex-wrap justify-between gap-x-4 py-1.5">
                        <span className="font-semibold">{entry.method}</span>
                        <span className="text-muted-foreground">{entry.from} to {entry.to ?? "now"}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                Contracted service, authorities and start date are derived from the signed contract and the engagement record; they are managed in the{" "}
                <ManageLink href={workspace(company.id, "onboarding")} label="onboarding and contracts workspace" />.
              </p>
            </Card>
          )}

          <Card title="Business Information" action={canEdit ? <ManageLink href={workspace(company.id, "edit")} label="Edit" /> : undefined}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ReadOnlyField label="Incorporation / Charter Number" value={company.incorpNo} />
              <ReadOnlyField label="CRA Business Number (BN)" value={company.businessNo} />
              <ReadOnlyField label="GST/HST Account" value={withheld("registrations") ? RESTRICTED : company.gstHst} />
              <ReadOnlyField label="IRS Employer ID (EIN)" value={company.ein} />
              <ReadOnlyField label="Registered Province/State" value={company.regCorpState} />
            </div>
          </Card>

          <Card title="Carrier Information" action={<ManageLink href={workspace(company.id, "authorities")} label="Manage in Authorities" />}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {isCanada && (
                <>
                  <ReadOnlyField label="MVID / RIN #" value={withheld("authorities") ? RESTRICTED : company.mvid} />
                  <ReadOnlyField label="NSC / CVOR #" value={withheld("authorities") ? RESTRICTED : company.nsc} />
                </>
              )}
              {isUS && (
                <>
                  <ReadOnlyField label="US DOT #" value={withheld("authorities") ? RESTRICTED : company.usdot} />
                  <ReadOnlyField label="MC #" value={withheld("authorities") ? RESTRICTED : company.mc} />
                </>
              )}
            </div>
          </Card>

          <Card title="Tax & Compliance Accounts" action={<ManageLink href={workspace(company.id, "tax-filing")} label="Manage in Tax Filing" />}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ReadOnlyField label="IRP Account #" value={withheld("authorities") ? RESTRICTED : company.accIrp} />
              <ReadOnlyField label="IFTA Account #" value={withheld("registrations") ? RESTRICTED : company.accIfta} />
              {isUS && (
                <>
                  <ReadOnlyField label="NY HUT Account #" value={withheld("registrations") ? RESTRICTED : company.accNyhut} />
                  <ReadOnlyField label="NM WDT Account #" value={withheld("registrations") ? RESTRICTED : company.accNm} />
                  <ReadOnlyField label="Kentucky KYU #" value={withheld("registrations") ? RESTRICTED : company.accKyu} />
                  <ReadOnlyField label="Oregon Account #" value={withheld("registrations") ? RESTRICTED : company.accOr} />
                  <ReadOnlyField label="CT DRS Account #" value={withheld("registrations") ? RESTRICTED : company.accCt} />
                </>
              )}
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            {showCustoms && (
              <Card title="Customs Information" action={<ManageLink href={workspace(company.id, "tax-filing")} label="Manage" />}>
                <div className="grid gap-4">
                  <ReadOnlyField label="SCAC" value={withheld("registrations") ? RESTRICTED : company.scac} />
                  <ReadOnlyField label="Carrier Code" value={withheld("registrations") ? RESTRICTED : company.carrierCode} />
                </div>
              </Card>
            )}
            <div className={!showCustoms ? "sm:col-span-2" : ""}>
              <Card title="Fleet Information" action={canEdit ? <ManageLink href={workspace(company.id, "edit")} label="Edit" /> : undefined}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReadOnlyField label="ELD / HOS Provider" value={withheld("operatingProfile") ? RESTRICTED : company.eldProvider} />
                  <ReadOnlyField label="Truck GPS Provider" value={withheld("operatingProfile") ? RESTRICTED : company.gpsProvider} />
                  <ReadOnlyField label="Fuel Provider" value={withheld("operatingProfile") ? RESTRICTED : company.fuelProvider} />
                </div>
              </Card>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: the canonical change history */}
        <div className="min-w-0 lg:col-span-1">
          <CompanyActivityPanel companyId={company.id} companyName={company.legalName || company.name} onChanged={reload} />
        </div>
      </div>
    </div>
  )
}
