"use client"

import React, { useEffect, useState } from "react"
import {
  ArrowLeft,
  Building2,
  MapPin,
  CheckCircle2,
  AlertCircle,
  FileText,
  Calendar,
} from "lucide-react"

import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { LoadingState, EmptyState } from "@/src/components/shared/StateDisplays"

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

type Tone = "ok" | "warn" | "danger" | "neutral" | "info"

const toneClass: Record<Tone, string> = {
  ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
  info: "bg-primary/10 text-primary",
}

function StatusBadge({ tone = "neutral", children }: { tone?: Tone | string; children: React.ReactNode }) {
  const selectedTone = (toneClass[tone as Tone] ? tone : "neutral") as Tone
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${toneClass[selectedTone]}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}

export default function CompanyProfilePage() {
  const params = useRouteParams()
  const router = useNavigationRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const id = params?.id as string
    try {
      const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
      const found = savedCompanies.find((c: any) => c.id === id)
      setCompany(found || null)
    } catch {
      setCompany(null)
    } finally {
      setLoading(false)
    }
  }, [params?.id])

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
          title="Company Not Found"
          description="The requested company record could not be found in the directory."
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
  const opRegion = company.region || "Canada Only"
  const isCanada = opRegion === "Canada Only" || opRegion === "Cross-Border"
  const isUS = opRegion === "US Only" || opRegion === "Cross-Border"
  const showCustoms = opRegion === "Cross-Border"

  const formatAddress = (prefix: string) => {
    const street = company[`${prefix}_street`]
    const city = company[`${prefix}_city`]
    const state = company[`${prefix}_state`]
    const zip = company[`${prefix}_zip`]
    const country = company[`${prefix}_country`]

    if (!street && !city && !state) return null
    return (
      <div className="text-sm font-medium leading-snug">
        {street}
        <br />
        {city && state ? `${city}, ${state} ${zip}` : ""}
        <br />
        {country}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-10">
      {/* 1. HEADER & STATS BAR */}
      <div className="bg-card rounded-lg border border-border shadow-xs p-4 flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div className="flex items-start gap-4">
            <div className="flex shrink-0 size-16 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
              <Building2 className="size-7 opacity-50" />
            </div>

            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-muted-foreground font-medium">{company.kind}</span>
                <StatusBadge tone={company.tone || "ok"}>{company.status}</StatusBadge>
              </div>
              <h1 className="text-xl font-bold tracking-tight">{company.name}</h1>
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => router.push(`/companies/${company.id}/edit`)}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted text-foreground transition-colors shadow-2xs"
            >
              Edit
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted text-foreground transition-colors shadow-2xs"
            >
              Check Status
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
            >
              New Case
            </button>
          </div>
        </div>

        {/* COMPACT STATS BAR */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-border">
          <div className="flex flex-wrap items-center gap-x-6 sm:gap-x-8 gap-y-3 text-sm">
            <div>
              <p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Operating Region</p>
              <p className="font-medium">{company.region}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Staff</p>
              <p className="font-medium">0</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Trucks</p>
              <p className="font-medium">0</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Trailers</p>
              <p className="font-medium">0</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Accounts</p>
              <p className="font-medium flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" /> Good
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Items</p>
              <p className="font-medium flex items-center gap-1 text-amber-500">
                <AlertCircle className="size-3.5" /> Pending
              </p>
            </div>
          </div>

          <div className="bg-muted/40 border border-border rounded-md px-4 py-1.5 text-right shrink-0">
            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-0.5">
              Assessment Date
            </p>
            <p className="font-semibold text-sm flex items-center justify-end gap-1.5 text-primary">
              <Calendar className="size-3.5" />
              {company.assessmentDate || "Pending"}
            </p>
          </div>
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
              <ReadOnlyField label="Phone" value={company.phone} />
              <ReadOnlyField label="Website" value={company.website} />
              <ReadOnlyField label="Account Email" value={company.email} />
              <ReadOnlyField label="Billing Email" value={company.billingEmail} />
              <ReadOnlyField label="Primary Contact" value={company.contact} />
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
            <>
              <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-primary">Customer Information</h3>
                </div>
                <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <ReadOnlyField label="Service Type" value={company.svcType} />
                  <ReadOnlyField label="Service Status" value={company.status} />
                  <ReadOnlyField label="Start Date" value={company.startDate} />
                  <ReadOnlyField label="End Date" value={company.endDate} />
                  <ReadOnlyField label="Operating Region" value={company.opRegion} />
                  <ReadOnlyField label="Payment Method" value={company.payMethod} />
                  <ReadOnlyField label="Cargo Information" value={company.cargoInfo} />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-primary">Business Information</h3>
                </div>
                <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <ReadOnlyField
                    label={
                      opRegion === "Canada Only"
                        ? "Canadian Corporate Number"
                        : opRegion === "US Only"
                        ? "State File / Charter Number"
                        : "Incorporation # / State File"
                    }
                    value={company.incorpNo}
                  />
                  <ReadOnlyField
                    label={
                      opRegion === "Canada Only"
                        ? "CRA Business Number (BN)"
                        : opRegion === "US Only"
                        ? "IRS Employer ID (EIN)"
                        : "Business Number / EIN"
                    }
                    value={company.businessNo}
                  />
                  <ReadOnlyField
                    label={
                      opRegion === "Canada Only"
                        ? "GST / HST Account"
                        : opRegion === "US Only"
                        ? "State Sales Tax ID"
                        : "Tax Registration #"
                    }
                    value={company.gstHst}
                  />
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
                      <ReadOnlyField label="MVID / RIN #" value={company.mvid} />
                      <ReadOnlyField label="NSC / CVOR #" value={company.nsc} />
                    </>
                  )}
                  {isUS && (
                    <>
                      <ReadOnlyField label="US DOT #" value={company.usdot} />
                      <ReadOnlyField label="MC #" value={company.mc} />
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-primary">Tax & Compliance Accounts</h3>
                </div>
                <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <ReadOnlyField label="IRP Account #" value={company.accIrp} />
                  <ReadOnlyField label="IFTA Account #" value={company.accIfta} />
                  {isUS && (
                    <>
                      <ReadOnlyField label="NY HUT Account #" value={company.accNyhut} />
                      <ReadOnlyField label="NM WDT Account #" value={company.accNm} />
                      <ReadOnlyField label="Kentucky KYU #" value={company.accKyu} />
                      <ReadOnlyField label="Oregon Account #" value={company.accOr} />
                      <ReadOnlyField label="CT DRS Account #" value={company.accCt} />
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
                      <ReadOnlyField label="SCAC" value={company.scac} />
                      <ReadOnlyField label="Carrier Code" value={company.carrierCode} />
                    </div>
                  </div>
                )}

                <div className={`rounded-xl border border-border bg-card shadow-xs overflow-hidden ${!showCustoms ? "sm:col-span-2" : ""}`}>
                  <div className="bg-muted/30 py-2.5 px-4 border-b border-border">
                    <h3 className="text-sm font-semibold text-primary">Fleet Information</h3>
                  </div>
                  <div className="p-4 grid sm:grid-cols-2 gap-4">
                    <ReadOnlyField label="Truck GPS Provider" value={company.gpsProvider} />
                    <ReadOnlyField label="Fuel Provider" value={company.fuelProvider} />
                  </div>
                </div>
              </div>
            </>
          )}
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
                  <p className="text-sm font-medium">Record Created</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {company.createdAt ? new Date(company.createdAt).toISOString().split("T")[0] : "Unknown Date"} • Admin
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-border flex flex-col gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quick Note</label>
                <textarea
                  placeholder="Add a quick note..."
                  className="min-h-[90px] w-full rounded-lg border border-border bg-background p-2.5 text-xs focus:border-primary focus:outline-hidden resize-none"
                />
                <button
                  type="button"
                  className="w-full rounded-lg bg-primary py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
                >
                  Save Note
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
"use client"

import React, { useEffect, useState } from "react"
import {
  ArrowLeft,
  Building2,
  MapPin,
  CheckCircle2,
  AlertCircle,
  FileText,
  Calendar,
} from "lucide-react"

import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { LoadingState, EmptyState } from "@/src/components/shared/StateDisplays"