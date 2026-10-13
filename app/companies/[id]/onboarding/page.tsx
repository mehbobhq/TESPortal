"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { CheckCircle2, Circle, FileWarning, Loader2, ShieldCheck } from "lucide-react"

import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type StepStatus = "complete" | "available" | "blocked" | "missing"
type Scope = { id: string; productLevel: string; serviceCode: string | null }
type Responsibility = { id: string; scopeId: string }
type OnboardingView = {
  company: { id: string; name: string; kind: string; status: string; region: string }
  relationship: {
    customer: { id: string } | null
    openEngagement: null | {
      engagement: { id: string; engagementType: string }
      current: { stage: { stage: string } | null; scopes: Scope[]; responsibilities: Responsibility[] }
    }
  }
  operatingProfile: {
    operatingScope: { assertion: { operatingScope: string } | null }
    driverRequirements: { assertion: { minimumDriverAgeYears: number; minimumDriverExperienceMonths: number } | null }
  }
  counts: {
    authorities: number
    contracts: number
    credentials: number
    evidenceDocuments: number
    evidenceRequirements: number
    drivers: number
    insurancePolicies: number
    taxRegistrations: number
    vehicles: number
  }
  evidenceRequirements: Array<{ id: string; requirementCode: string; requirementLabel: string; requiredFor: string; requirementStatus: string }>
  authorityRoles: { serviceDecisionAuthority: boolean; contractSignatory: boolean }
  steps: Array<{ key: string; label: string; status: StepStatus; detail: string; href?: string }>
  readiness: {
    status: "ready" | "in_progress" | "blocked" | "missing_evidence" | "settings_required" | "ready_for_contract" | "ready_for_service_start"
    completed: number
    total: number
    blockers: string[]
  }
}

const PRODUCT_LEVELS = [
  { value: "COMPLIANCE", label: "Compliance" },
  { value: "BUSINESS_INTELLIGENCE", label: "Business intelligence" },
  { value: "DECISION_SUPPORT", label: "Decision support" },
]

const OPERATING_SCOPES = [
  { value: "CANADA", label: "Canada only" },
  { value: "UNITED_STATES", label: "United States only" },
  { value: "CANADA_AND_UNITED_STATES", label: "Canada and United States" },
]

function statusVariant(status: StepStatus) {
  if (status === "complete") return "default"
  if (status === "blocked" || status === "missing") return "destructive"
  return "outline"
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "complete") return <CheckCircle2 className="size-4 text-emerald-600" />
  if (status === "blocked" || status === "missing") return <FileWarning className="size-4 text-destructive" />
  return <Circle className="size-4 text-muted-foreground" />
}

export default function OnboardingPage() {
  const params = useParams()
  const companyId = params.id as string
  const [data, setData] = useState<OnboardingView | null>(null)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState("")
  const [scope, setScope] = useState("COMPLIANCE")
  const [operatingScope, setOperatingScope] = useState("CANADA_AND_UNITED_STATES")
  const [minimumAge, setMinimumAge] = useState("23")
  const [minimumExperience, setMinimumExperience] = useState("24")

  const base = `/api/companies/${encodeURIComponent(companyId)}/onboarding`

  async function load() {
    setError("")
    const response = await fetch(base, { cache: "no-store" })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? "Unable to load onboarding.")
    setData(body)
  }

  useEffect(() => {
    let cancelled = false
    setData(null)
    load().catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Unable to load onboarding."))
    return () => {
      cancelled = true
    }
  }, [base])

  async function action(name: string, payload: Record<string, unknown>) {
    setSaving(name)
    setError("")
    try {
      const response = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? "Unable to update onboarding.")
      setData(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update onboarding.")
    } finally {
      setSaving("")
    }
  }

  const open = data?.relationship.openEngagement ?? null
  const scopes = open?.current.scopes ?? []
  const responsibilities = open?.current.responsibilities ?? []
  const responsibilityScopeIds = useMemo(() => new Set(responsibilities.map((row) => row.scopeId)), [responsibilities])
  const firstUnassumedScope = scopes.find((row) => !responsibilityScopeIds.has(row.id))

  if (error && !data) return <div className="p-10 text-center text-sm text-destructive">{error}</div>
  if (!data) return <div className="p-10 text-center text-sm text-muted-foreground">Loading onboarding...</div>

  const readinessLabel =
    data.readiness.status === "ready_for_service_start"
      ? "Ready for service start"
      : data.readiness.status === "ready_for_contract"
        ? "Ready for contract"
        : data.readiness.status === "missing_evidence"
          ? "Missing evidence"
          : data.readiness.status === "settings_required"
            ? "Settings required"
            : data.readiness.status === "ready"
              ? "Ready"
              : data.readiness.status === "blocked"
                ? "Blocked"
                : "In progress"

  return (
    <div className="flex flex-col gap-6 pb-10">
      <CompanyWorkspaceHeader
        company={data.company}
        section="Onboarding"
        description="Canonical customer setup, service scope, responsibility, settings and readiness."
      />

      {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader className="border-b bg-muted/30 py-3">
            <CardTitle className="text-sm">Canonical sequence</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {data.steps.map((step) => (
              <div key={step.key} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="flex gap-3">
                  <StepIcon status={step.status} />
                  <div>
                    <div className="text-sm font-medium">{step.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{step.detail}</div>
                  </div>
                </div>
                <Badge variant={statusVariant(step.status)} className="capitalize">
                  {step.status.replace("_", " ")}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-muted/30 py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4" />
              Readiness
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div>
              <div className="text-2xl font-semibold">{readinessLabel}</div>
              <div className="text-xs text-muted-foreground">
                {data.readiness.completed} of {data.readiness.total} readiness checks complete.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {Object.entries(data.counts).map(([key, value]) => (
                <div key={key} className="rounded-lg border p-2">
                  <div className="font-semibold">{value}</div>
                  <div className="capitalize text-muted-foreground">{key.replace(/([A-Z])/g, " $1")}</div>
                </div>
              ))}
            </div>
            {data.readiness.blockers.length > 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                Blocked by: {data.readiness.blockers.join(", ")}.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="border-b bg-muted/30 py-3">
            <CardTitle className="text-sm">Customer relationship</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <p className="text-xs text-muted-foreground">
              {open ? `Open engagement ${open.engagement.id.slice(0, 8)} is in ${open.current.stage?.stage ?? "unknown"} stage.` : "No open engagement yet."}
            </p>
            <Button
              size="sm"
              disabled={Boolean(open) || saving === "establish"}
              onClick={() => action("establish", { action: "establish", engagementType: "RECURRING", stage: "ONBOARDING" })}
            >
              {saving === "establish" ? <Loader2 className="size-4 animate-spin" /> : null}
              Establish customer relationship
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-muted/30 py-3">
            <CardTitle className="text-sm">Service scope and responsibility</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div className="space-y-1.5">
              <Label>Product layer</Label>
              <Select value={scope} onValueChange={(value) => value && setScope(value)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_LEVELS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!open || saving === "scope"} onClick={() => action("scope", { action: "addScope", engagementId: open?.engagement.id, productLevel: scope })}>
                Add scope
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!firstUnassumedScope || saving === "responsibility"}
                onClick={() => action("responsibility", { action: "assumeResponsibility", scopeId: firstUnassumedScope?.id })}
              >
                Assume next responsibility
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {scopes.length} scope{scopes.length === 1 ? "" : "s"}; {responsibilities.length} responsibility window{responsibilities.length === 1 ? "" : "s"}.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-muted/30 py-3">
            <CardTitle className="text-sm">Required settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div className="space-y-1.5">
              <Label>Operating scope</Label>
              <Select value={operatingScope} onValueChange={(value) => value && setOperatingScope(value)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATING_SCOPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" disabled={saving === "operatingScope"} onClick={() => action("operatingScope", { action: "setOperatingScope", operatingScope })}>
              Set operating scope
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Min age</Label>
                <Input value={minimumAge} onChange={(event) => setMinimumAge(event.target.value)} inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label>Min months</Label>
                <Input value={minimumExperience} onChange={(event) => setMinimumExperience(event.target.value)} inputMode="numeric" />
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={saving === "driverRequirements"}
              onClick={() =>
                action("driverRequirements", {
                  action: "setDriverRequirements",
                  minimumDriverAgeYears: Number(minimumAge),
                  minimumDriverExperienceMonths: Number(minimumExperience),
                })
              }
            >
              Set driver minimums
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="border-b bg-muted/30 py-3">
            <CardTitle className="text-sm">Evidence requirements</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {data.evidenceRequirements.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No evidence requirement records have been created yet.</div>
            ) : (
              data.evidenceRequirements.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">{item.requirementLabel}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {item.requirementCode} · {item.requiredFor.replaceAll("_", " ")}
                    </div>
                  </div>
                  <Badge variant={item.requirementStatus === "verified" || item.requirementStatus === "waived" ? "default" : "outline"}>
                    {item.requirementStatus.replaceAll("_", " ")}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-muted/30 py-3">
            <CardTitle className="text-sm">Authority and contract gates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span>Service Decision Authority</span>
              <Badge variant={data.authorityRoles.serviceDecisionAuthority ? "default" : "outline"}>
                {data.authorityRoles.serviceDecisionAuthority ? "Assigned" : "Missing"}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span>Contract Signatory</span>
              <Badge variant={data.authorityRoles.contractSignatory ? "default" : "outline"}>
                {data.authorityRoles.contractSignatory ? "Assigned" : "Missing"}
              </Badge>
            </div>
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              Contract generation stays blocked until both authority roles and required evidence are present.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
