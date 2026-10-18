"use client"

import React, { useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  Building2,
  MapPin,
  CheckCircle2,
  AlertCircle,
  FileText,
  Calendar,
  Activity,
} from "lucide-react"

import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { LoadingState, EmptyState } from "@/src/components/shared/StateDisplays"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"

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
  notRecordedYet: string[]
}

const ACTIVITY_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "Vehicles", value: "vehicles" },
  { label: "Drivers", value: "drivers" },
  { label: "Insurance", value: "insurance" },
  { label: "Authorities", value: "authorities" },
  { label: "Documents", value: "documents" },
]

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ""
  const diffMs = Date.now() - then
  const diffSec = Math.max(0, Math.floor(diffMs / 1000))
  if (diffSec < 60) return "Just now"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay === 1) return "Yesterday"
  if (diffDay < 7) return `${diffDay} days ago`
  const diffWeek = Math.floor(diffDay / 7)
  if (diffWeek < 5) return `${diffWeek} week${diffWeek === 1 ? "" : "s"} ago`
  const diffMonth = Math.floor(diffDay / 30)
  if (diffMonth < 12) return `${diffMonth} month${diffMonth === 1 ? "" : "s"} ago`
  const diffYear = Math.floor(diffDay / 365)
  return `${diffYear} year${diffYear === 1 ? "" : "s"} ago`
}

function useRouteParams(): { id?: string } {
  if (typeof window !== "undefined") {
    const pathParts = window.location.pathname.split("/").filter(Boolean)
    const companyIndex = pathParts.indexOf("companies")
    if (companyIndex !== -1 && pathParts[companyIndex + 1]) {
      return { id: pathParts[companyIndex + 1] }
    }
  }
  return { id: undefined }
}

function useNavigationRouter() {
  return {
    push: (url: string) => {
      if (typeof window !== "undefined") {
        window.location.href = url
      }
    },
    back: () => {
      if (typeof window !== "undefined") {
        window.history.back()
      }
    },
  }
}

type ActivityEntry = { id: string; action: string; entityLabel?: string; detail?: string; t: string }

export default function CompanyProfilePage() {
  const params = useRouteParams()
  const router = useNavigationRouter()
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activityFilter, setActivityFilter] = useState<string>("all")
  const [activityLimit, setActivityLimit] = useState(20)
  // Real counts from the canonical lists (the original bar showed hard-coded zeros). null = not loaded, "denied" = not permitted.
  const [fleet, setFleet] = useState<{ trucks: number; trailers: number; drivers: number } | "denied" | null>(null)

  useEffect(() => {
    const id = params?.id as string
    if (!id) {
      setCompany(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
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
          setError("Company profile could not be loaded from PostgreSQL.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [params?.id])

  useEffect(() => {
    const id = params?.id as string
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
  }, [params?.id])

  // Deferred: no canonical activity read service exists yet; the browser-stored feed was removed.
  const activity: ActivityEntry[] = []

  if (loading) {
    return (
      <div className="p-10">
        <LoadingState message="Loading company profile..." />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
        <EmptyState
          icon={<Building2 className="size-10 text-muted-foreground/60" />}
          title={error ? "Company Profile Unavailable" : "Company Not Found"}
          description={error ?? "The requested company record could not be found in the PostgreSQL directory."}
          action={{
            label: "Back to Directory",
            onClick: () => router.push("/companies"),
            icon: <ArrowLeft className="size-4" />,
          }}
        />
      </div>
    )
  }

  // --- Dynamic Visibility Logic ---
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

  const formatAddress = (prefix: "reg" | "mail" | "yard") => {
    const street = company[`${prefix}_street`]
    const city = company[`${prefix}_city`]
    const state = company[`${prefix}_state`]
    const zip = company[`${prefix}_zip`]
    const country = company[`${prefix}_country`]

    if (withheld("locations")) return <p className="text-sm text-muted-foreground font-medium">Not permitted to view</p>
    if (!street && !city && !state) return null
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

  const profileActions = (
    <>
      <button
        type="button"
        onClick={() => router.push(`/companies/${company.id}/edit`)}
        className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted text-foreground transition-colors shadow-2xs"
      >
        Edit
      </button>
      <button
        type="button"
        disabled
        title="Not available yet"
        className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground opacity-60 shadow-2xs"
      >
        Check Status
      </button>
      <button
        type="button"
        disabled
        title="Not available yet"
        className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground opacity-50 shadow-2xs"
      >
        New Case
      </button>
    </>
  )

  return (
    <div className="flex flex-col gap-4 pb-10">
      <CompanyWorkspaceHeader company={company} section="Profile" actions={profileActions} />

      {/* 1. RECORD SUMMARY (values read from PostgreSQL; nothing here is estimated) */}
      <div className="bg-card rounded-lg border border-border shadow-xs p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 sm:gap-x-8 gap-y-3 text-sm">
          <div>
            <p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Operating Region</p>
            <p className="font-medium">{withheld("operatingProfile") ? "Not permitted to view" : company.opRegion ?? "Not recorded"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Registered In</p>
            <p className="font-medium">{company.region}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Record Status</p>
            <p className="font-medium">{company.status}</p>
          </div>
          {([["Trucks", "trucks"], ["Trailers", "trailers"], ["Drivers", "drivers"]] as const).map(([label, key]) => (
            <div key={key}>
              <p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">{label}</p>
              <p className="font-medium">{fleet === null ? "…" : fleet === "denied" ? "Not permitted to view" : fleet[key]}</p>
            </div>
          ))}
          {isCustomer && (
            <div>
              <p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Service Stage</p>
              <p className="font-medium">{withheld("customer") ? "Not permitted to view" : company.serviceStage ?? "Not recorded"}</p>
            </div>
          )}
        </div>
      </div>

      {/* 2. MAIN GRID LAYOUT */}
      <div className="grid lg:grid-cols-3 gap-4 items-start">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <Building2 className="size-4 text-muted-foreground" /> Company Information
              </h3>
            </div>
            <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <ReadOnlyField label="Company Name" value={company.name} />
              <ReadOnlyField label="Company Record Type" value={company.kind} />
              <ReadOnlyField label="DBA" value={company.dba} />
              <ReadOnlyField label="Phone" value={withheld("contacts") ? "Not permitted to view" : company.phone} />
              <ReadOnlyField label="Website" value={withheld("contacts") ? "Not permitted to view" : company.website} />
              <ReadOnlyField label="Account Email" value={withheld("contacts") ? "Not permitted to view" : company.email} />
              <ReadOnlyField label="Billing Email" value={withheld("contacts") ? "Not permitted to view" : company.billingEmail} />
              <ReadOnlyField label="Primary Contact" value={withheld("contacts") ? "Not permitted to view" : company.contact} />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <MapPin className="size-4 text-muted-foreground" /> Address Information
              </h3>
            </div>
            <div className="p-4 grid sm:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1 border-b sm:border-b-0 pb-2 sm:pb-0">
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Registered Address</p>
                {formatAddress("reg") || <p className="text-sm text-muted-foreground font-medium">—</p>}
              </div>

              {isCustomer && (
                <>
                  <div className="flex flex-col gap-1 border-b sm:border-b-0 pb-2 sm:pb-0">
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Mailing Address</p>
                    {formatAddress("mail") || <p className="text-sm text-muted-foreground font-medium">—</p>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Yard Address</p>
                    {formatAddress("yard") || <p className="text-sm text-muted-foreground font-medium">—</p>}
                  </div>
                </>
              )}
            </div>
          </div>

          {isCustomer && (
              <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-primary">Customer Information</h3>
                </div>
                <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <ReadOnlyField label="Service Type" value={serviceTypeText} />
                  <ReadOnlyField label="Service Status" value={withheld("customer") ? "Not permitted to view" : stageLabel} />
                  <ReadOnlyField label="Service Start Date" value={withheld("customer") ? "Not permitted to view" : company.startDate} />
                  <ReadOnlyField label="End Date" value={withheld("customer") ? "Not permitted to view" : company.endDate} />
                  {!withheld("customer") && company.engagements.length > 1 && (
                    <ReadOnlyField
                      label="Previous Engagements"
                      value={company.engagements.filter((engagement) => !engagement.current).map((engagement) => `${engagement.startedAt} to ${engagement.endedAt ?? "open"}`).join("; ")}
                    />
                  )}
                  <ReadOnlyField label="Company Status" value={company.status} />
                  <ReadOnlyField label="Operating Region" value={withheld("operatingProfile") ? "Not permitted to view" : company.opRegion} />
                  <ReadOnlyField label="Payment Method" value={withheld("customer") ? "Not permitted to view" : company.payMethod} />
                  <ReadOnlyField label="Cargo Information" value={withheld("operatingProfile") ? "Not permitted to view" : company.cargoTypes.length > 0 ? company.cargoTypes.join(", ") : null} />
                </div>
              </div>
          )}

          <>
              <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-primary">Business Information</h3>
                </div>
                <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <ReadOnlyField
                    label="Incorporation / Charter Number"
                    value={company.incorpNo}
                  />
                  <ReadOnlyField
                    label="CRA Business Number (BN)"
                    value={company.businessNo}
                  />
                  <ReadOnlyField label="IRS Employer ID (EIN)" value={company.ein} />
                  <ReadOnlyField label="Registered Province/State" value={company.regCorpState} />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-primary">Carrier Information</h3>
                </div>
                <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {isCanada && (
                    <>
                      <ReadOnlyField label="MVID / RIN #" value={withheld("authorities") ? "Not permitted to view" : company.mvid} />
                      <ReadOnlyField label="NSC / CVOR #" value={withheld("authorities") ? "Not permitted to view" : company.nsc} />
                    </>
                  )}
                  {isUS && (
                    <>
                      <ReadOnlyField label="US DOT #" value={withheld("authorities") ? "Not permitted to view" : company.usdot} />
                      <ReadOnlyField label="MC #" value={withheld("authorities") ? "Not permitted to view" : company.mc} />
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-primary">Tax & Compliance Accounts</h3>
                </div>
                <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <ReadOnlyField label="IRP Account #" value={withheld("authorities") ? "Not permitted to view" : company.accIrp} />
                  <ReadOnlyField label="IFTA Account #" value={withheld("registrations") ? "Not permitted to view" : company.accIfta} />
                  {isUS && (
                    <>
                      <ReadOnlyField label="NY HUT Account #" value={withheld("registrations") ? "Not permitted to view" : company.accNyhut} />
                      <ReadOnlyField label="NM WDT Account #" value={withheld("registrations") ? "Not permitted to view" : company.accNm} />
                      <ReadOnlyField label="Kentucky KYU #" value={withheld("registrations") ? "Not permitted to view" : company.accKyu} />
                      <ReadOnlyField label="Oregon Account #" value={withheld("registrations") ? "Not permitted to view" : company.accOr} />
                      <ReadOnlyField label="CT DRS Account #" value={withheld("registrations") ? "Not permitted to view" : company.accCt} />
                    </>
                  )}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                {showCustoms && (
                  <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                    <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
                      <h3 className="text-sm font-semibold text-primary">Customs Information</h3>
                    </div>
                    <div className="p-4 grid gap-4">
                      <ReadOnlyField label="SCAC" value={withheld("registrations") ? "Not permitted to view" : company.scac} />
                      <ReadOnlyField label="Carrier Code" value={withheld("registrations") ? "Not permitted to view" : company.carrierCode} />
                    </div>
                  </div>
                )}

                <div className={`rounded-xl border border-border bg-card shadow-xs overflow-hidden ${!showCustoms ? "sm:col-span-2" : ""}`}>
                  <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
                    <h3 className="text-sm font-semibold text-primary">Fleet Information</h3>
                  </div>
                  <div className="p-4 grid sm:grid-cols-2 gap-4">
                    <ReadOnlyField label="ELD / HOS Provider" value={withheld("operatingProfile") ? "Not permitted to view" : company.eldProvider} />
                    <ReadOnlyField label="Truck GPS Provider" value={withheld("operatingProfile") ? "Not permitted to view" : company.gpsProvider} />
                    <ReadOnlyField label="Fuel Provider" value={withheld("operatingProfile") ? "Not permitted to view" : company.fuelProvider} />
                    <ReadOnlyField label="Assessment Date" value="Not yet assessed" />
                  </div>
                </div>

                <div className={`rounded-xl border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground ${!showCustoms ? "sm:col-span-2" : ""}`}>
                  <p className="font-semibold text-foreground">Not recorded by the canonical system yet</p>
                  <p className="mt-1">
                    The GST/HST account has no canonical home yet, so no value is shown for it (an empty field would suggest none
                    exists). Service type comes from the signed contract, service status is the engagement stage, and the
                    assessment date is the latest readiness assessment; none of those is typed in.
                  </p>
                </div>
              </div>
          </>
        </div>

        {/* RIGHT COLUMN: Sticky Sidebar */}
        <div className="lg:col-span-1 sticky top-16 flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="py-2.5 px-4 border-b border-border bg-muted/10 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Activity & Notes</span>
            </div>
            <div className="p-4 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="flex shrink-0 items-center justify-center size-7 rounded-full border border-primary/20 text-primary bg-primary/5 mt-0.5">
                  <FileText className="size-3.5" />
                </div>
                <div className="flex flex-col">
                  <p className="text-sm font-medium">Record created</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {company.createdAt ? new Date(company.createdAt).toISOString().split("T")[0] : "Unknown Date"}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-border flex flex-col gap-2">
                <label htmlFor="quick-note" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quick Note</label>
                <textarea
                  id="quick-note"
                  disabled
                  placeholder="Notes have no canonical storage yet"
                  className="min-h-[90px] w-full rounded-lg border border-border bg-background p-2.5 text-xs resize-none opacity-60"
                />
                <button
                  type="button"
                  disabled
                  className="w-full rounded-lg bg-primary py-1.5 text-xs font-semibold text-primary-foreground opacity-50 shadow-2xs"
                >
                  Save Note
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. ACTIVITY FEED */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <Activity className="size-4 text-muted-foreground" /> Activity
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">All changes across this company</p>
        </div>
        <div className="p-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {ACTIVITY_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => {
                  setActivityFilter(filter.value)
                  setActivityLimit(20)
                }}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  activityFilter === filter.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {activity.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Activity history is unavailable until a canonical activity read service exists.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {activity.slice(0, activityLimit).map((entry: ActivityEntry) => (
                <div key={entry.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="mt-1.5 size-1.5 rounded-full bg-primary/60 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {entry.action}
                        {entry.entityLabel ? ` — ${entry.entityLabel}` : ""}
                      </p>
                      {entry.detail ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.detail}</p>
                      ) : null}
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">
                    {relativeTime(entry.t)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {activity.length > activityLimit && (
            <button
              type="button"
              onClick={() => setActivityLimit((current) => current + 20)}
              className="mx-auto rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted text-foreground transition-colors shadow-2xs"
            >
              Load more
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
