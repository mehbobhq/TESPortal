"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Save, Building2 } from "lucide-react"

import { ENGAGEMENT_END_REASONS } from "@/lib/customer-relationship/definitions"
import { CompanyMissing } from "@/components/company-missing"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type ServiceTypeState =
  | { state: "contracted"; packages: string[]; contractReference: string | null }
  | { state: "not_contracted" }
  | { state: "restricted" }

type Details = Record<string, string | string[] | ServiceTypeState | null | undefined> & {
  kind?: string
  opRegion?: string | null
  website?: string | null
  gstHst?: string | null
  sections?: Record<string, string>
  cargoTypes?: string[]
  eldProvider?: string | null
  gpsProvider?: string | null
  fuelProvider?: string | null
  payMethod?: string | null
  serviceType?: ServiceTypeState | null
  serviceStage?: string | null
  startDate?: string | null
}

/** The cargo categories and payment methods of the original form (the database catalogues are authoritative). */
const CARGO_OPTIONS = ["General Freight", "Specialized Equipment", "Household Goods", "Temperature-Controlled & Food", "Hazardous Materials", "Bulk & Other"]
const PAYMENT_METHODS = ["E-Transfer", "Credit Card", "Wire Transfer", "Cheque"]

const STAGE_LABEL: Record<string, string> = {
  ONBOARDING: "Onboarding",
  TRIAL: "Trial",
  ACTIVE: "Active",
  MANAGED_PROBATION: "Managed probation",
  SUSPENDED: "Suspended",
  ENDED: "Ended",
}

const asText = (value: unknown): string => (typeof value === "string" ? value : "")

function serviceTypeText(state: ServiceTypeState | null | undefined): string {
  if (!state) return "Not recorded"
  if (state.state === "restricted") return "Not permitted to view"
  if (state.state === "not_contracted") return "Not contracted"
  return state.packages.length > 0 ? state.packages.join(", ") : "Contracted (no package recorded)"
}

type EditableCompany = {
  id: string
  companyName: string
  dba: string
  incorpNo: string
  businessNo: string
  ein: string
}

const ADDRESS_BLOCKS = [
  { prefix: "reg", title: "Registered Address", customerOnly: false },
  { prefix: "mail", title: "Mailing Address", customerOnly: true },
  { prefix: "yard", title: "Yard / Home Terminal Address", customerOnly: true },
] as const

const DEFERRED_SECTIONS = [
  "Contact person, phone and email — managed in the Contacts workspace",
  "Carrier numbers (USDOT, MC, NSC, MVID) — managed in Authorities",
  "Tax programme accounts and customs codes (SCAC, Carrier Code) — managed in Tax Filing registrations",
  "GST/HST account and US state tax registration — no canonical tax registration program exists yet",
  "TES Service Start Date — fixed once recorded; a verified correction with a reason is a separate dependency",
  "Service type (from the signed contract), service status (the engagement stage) and assessment date (a future company documentation assessment; Not yet assessed until one exists) — shown read-only",
]

export default function EditCompanyPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<EditableCompany | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [details, setDetails] = useState<Details>({})
  const [issues, setIssues] = useState<Array<{ field: string; message: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargo, setCargo] = useState<string[]>([])

  useEffect(() => {
    const id = params.id as string
    let cancelled = false
    Promise.all([
      fetch(`/api/companies/${encodeURIComponent(id)}`, { cache: "no-store" })
        .then(async (response) => ({ company: response.ok ? (await response.json()).company : null, failed: !response.ok && response.status !== 404 }))
        .catch(() => ({ company: null, failed: true })),
      fetch(`/api/companies/${encodeURIComponent(id)}/profile`, { cache: "no-store" })
        .then(async (response) => (response.ok ? (await response.json()).company : null))
        .catch(() => null),
    ]).then(([found, profile]) => {
      if (cancelled) return
      setCompany(found.company ?? null)
      setLookupFailed(found.failed)
      setDetails(profile ?? {})
      setCargo(Array.isArray(profile?.cargoTypes) ? profile.cargoTypes : [])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [params.id])

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!company) return
    const form = new FormData(e.currentTarget)
    const field = (name: string) => String(form.get(name) ?? "")
    setSaving(true)
    setError(null)
    setIssues([])
    const detailFields: Record<string, string> = { addressMode: field("addressMode") || "change", opRegion: field("opRegion"), factMode: field("factMode") || "change" }
    // Profile facts are sent only when they CHANGED from the loaded value, so an untouched field is never rewritten and a
    // cleared field is an explicit, intentional "clear" (an empty string).
    if (field("website").trim() !== asText(details.website)) detailFields.website = field("website").trim()
    if (details.sections?.registrations !== "not_permitted" && field("gstHst").trim() !== asText(details.gstHst)) detailFields.gstHst = field("gstHst").trim()
    if (details.kind === "Customer") {
      const before = [...(Array.isArray(details.cargoTypes) ? details.cargoTypes : [])].sort().join("|")
      if ([...cargo].sort().join("|") !== before) detailFields.cargoTypes = JSON.stringify(cargo)
      if (field("eldProvider").trim() !== asText(details.eldProvider)) detailFields.eldProvider = field("eldProvider").trim()
      if (field("gpsProvider").trim() !== asText(details.gpsProvider)) detailFields.gpsProvider = field("gpsProvider").trim()
      if (field("fuelProvider").trim() !== asText(details.fuelProvider)) detailFields.fuelProvider = field("fuelProvider").trim()
      if (field("payMethod") !== asText(details.payMethod)) detailFields.payMethod = field("payMethod")
    }
    for (const block of ADDRESS_BLOCKS) {
      for (const part of ["street", "city", "state", "zip", "country"]) detailFields[`${block.prefix}_${part}`] = field(`${block.prefix}_${part}`)
    }
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(company.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName: field("companyName"),
          dba: field("dba"),
          incorpNo: field("incorpNo"),
          businessNo: field("businessNo"),
          ein: field("ein"),
          ...detailFields,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error ?? "Unable to update company.")
        setIssues(Array.isArray(body?.issues) ? body.issues : [])
        return
      }
      router.push(`/companies/${company.id}/profile`)
    } catch {
      setError("Unable to update company.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <CompanyMissing failed={lookupFailed} />

  return (
    <div className="pb-10 flex flex-col gap-6">
      <PageHeader
        title={`Edit: ${company.companyName}`}
        description="Update company records and information."
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 size-4" /> Cancel
          </Button>
        }
      />

      <form onSubmit={handleUpdate} className="flex flex-col gap-6 max-w-5xl">
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" /> Core Information
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name</Label>
              <Input id="companyName" name="companyName" defaultValue={company.companyName} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dba">DBA</Label>
              <Input id="dba" name="dba" defaultValue={company.dba} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" name="website" type="url" placeholder="https://" maxLength={254} defaultValue={typeof details.website === "string" ? details.website : ""} />
              <p className="text-[11px] text-muted-foreground">Clear the field to remove the recorded website.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b">
            <CardTitle className="text-sm">Business Information</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="incorpNo">Incorporation Number</Label>
              <Input id="incorpNo" name="incorpNo" defaultValue={company.incorpNo} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="businessNo">Business Number (CRA BN)</Label>
              <Input id="businessNo" name="businessNo" defaultValue={company.businessNo} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gstHst">GST/HST Account</Label>
              <Input
                id="gstHst"
                name="gstHst"
                placeholder="123456789 RT 0001"
                maxLength={40}
                defaultValue={details.sections?.registrations === "not_permitted" ? "" : asText(details.gstHst)}
                disabled={details.sections?.registrations === "not_permitted"}
                aria-describedby={issues.some((issue) => issue.field === "gstHst") ? "gstHst-error" : undefined}
              />
              {details.sections?.registrations === "not_permitted" && <p className="text-[11px] text-muted-foreground">Not permitted to view or edit.</p>}
              {issues.filter((issue) => issue.field === "gstHst").map((issue) => (
                <p key={issue.message} id="gstHst-error" role="alert" className="text-xs text-destructive">{issue.message}</p>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ein">EIN (IRS)</Label>
              <Input id="ein" name="ein" defaultValue={company.ein} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b">
            <CardTitle className="text-sm">Operating Region</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="opRegion">Operating Region</Label>
              <select id="opRegion" name="opRegion" defaultValue={details.opRegion ?? ""} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                <option value="">{details.opRegion ? "(unchanged)" : "Not recorded"}</option>
                <option value="Canada Only">Canada Only</option>
                <option value="US Only">US Only</option>
                <option value="Cross-Border">Cross-Border</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {ADDRESS_BLOCKS.filter((block) => !block.customerOnly || details.kind === "Customer").map((block) => (
          <Card key={block.prefix}>
            <CardHeader className="bg-muted/30 py-3 border-b">
              <CardTitle className="text-sm">{block.title}</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {(["street", "city", "state", "zip", "country"] as const).map((part) => (
                <div className="space-y-2" key={part}>
                  <Label htmlFor={`${block.prefix}_${part}`}>{part === "zip" ? "Postal / ZIP" : part === "state" ? "Province / State (code)" : part[0].toUpperCase() + part.slice(1)}</Label>
                  <Input id={`${block.prefix}_${part}`} name={`${block.prefix}_${part}`} defaultValue={asText(details[`${block.prefix}_${part}`])} />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}

        {details.kind === "Customer" ? (
          <>
            <Card>
              <CardHeader className="bg-muted/30 py-3 border-b">
                <CardTitle className="text-sm">Customer Information</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label>Service Type</Label>
                  <p className="text-sm" data-testid="service-type">{serviceTypeText(details.serviceType)}</p>
                  <p className="text-[11px] text-muted-foreground">Read-only. It comes from the signed contract and cannot be changed here.</p>
                </div>
                <div className="space-y-2">
                  <Label>Service Status</Label>
                  <p className="text-sm" data-testid="service-stage">{details.serviceStage ? (STAGE_LABEL[details.serviceStage] ?? details.serviceStage) : "Not recorded"}</p>
                  <p className="text-[11px] text-muted-foreground">Read-only. It is the engagement stage, recorded through the engagement lifecycle.</p>
                </div>
                <div className="space-y-2">
                  <Label>TES Service Start Date</Label>
                  <p className="text-sm" data-testid="service-start">{details.startDate ?? "Not recorded"}</p>
                  <p className="text-[11px] text-muted-foreground">Fixed once recorded.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="payMethod">Payment Method</Label>
                  <select id="payMethod" name="payMethod" defaultValue={typeof details.payMethod === "string" ? details.payMethod : ""} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                    <option value="">Not specified</option>
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>{method}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">The preferred way to bill this customer. A preference only; contract payment terms are agreed separately.</p>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Cargo Information</Label>
                  <div className="flex flex-wrap gap-x-4 gap-y-2" role="group" aria-label="Cargo Information">
                    {CARGO_OPTIONS.map((option) => (
                      <label key={option} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={cargo.includes(option)}
                          onChange={(event) => setCargo((current) => (event.target.checked ? [...current.filter((item) => item !== option), option] : current.filter((item) => item !== option)))}
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">The kinds of freight the customer hauls. Descriptive only; it does not decide which regulations apply. At least one is required.</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="bg-muted/30 py-3 border-b">
                <CardTitle className="text-sm">Fleet Information</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="eldProvider">ELD / HOS Provider</Label>
                  <Input id="eldProvider" name="eldProvider" maxLength={120} defaultValue={typeof details.eldProvider === "string" ? details.eldProvider : ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gpsProvider">Truck GPS Provider</Label>
                  <Input id="gpsProvider" name="gpsProvider" maxLength={120} defaultValue={typeof details.gpsProvider === "string" ? details.gpsProvider : ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fuelProvider">Fuel Provider</Label>
                  <Input id="fuelProvider" name="fuelProvider" maxLength={120} defaultValue={typeof details.fuelProvider === "string" ? details.fuelProvider : ""} />
                </div>
                <div className="space-y-2">
                  <Label>Assessment Date</Label>
                  <p className="text-sm" data-testid="assessment-date">Not yet assessed</p>
                  <p className="text-[11px] text-muted-foreground">Read-only. Shown when a company documentation assessment has been completed; none has been yet.</p>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}

        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b">
            <CardTitle className="text-sm">When a website, GST/HST account, cargo, provider or payment method is edited</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-sm space-y-2">
            <label className="flex items-center gap-2">
              <input type="radio" name="factMode" value="change" defaultChecked /> It really changed — keep the earlier value as history
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="factMode" value="correct" /> The recorded value was wrong — correct it
            </label>
            <p className="text-xs text-muted-foreground">An unchanged value is not re-saved. Clearing a field ends it (or, for a correction, removes the wrong entry); nothing is deleted.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b">
            <CardTitle className="text-sm">When an address is edited</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-sm space-y-2">
            <label className="flex items-center gap-2">
              <input type="radio" name="addressMode" value="change" defaultChecked /> The address changed (the company moved) — keep the old address as history
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="addressMode" value="correct" /> The recorded address was wrong — correct it
            </label>
            <p className="text-xs text-muted-foreground">An address block cannot be cleared here; leave it as is. An unchanged address is not re-saved.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b">
            <CardTitle className="text-sm">Managed elsewhere, read-only, or not yet available</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-xs text-muted-foreground">
            <p className="mb-2">These are not edited on this page:</p>
            <ul className="list-disc pl-5 space-y-1">
              {DEFERRED_SECTIONS.map((section) => (
                <li key={section}>{section}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {error ? (
          <div role="alert" className="text-sm text-red-600">
            <p>{error}</p>
            {issues.length > 0 ? (
              <ul className="list-disc pl-5">
                {issues.map((item) => (
                  <li key={`${item.field}-${item.message}`}>{item.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            <Save className="mr-2 size-4" /> {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>

      {details.kind === "Customer" && details.serviceStage !== "ENDED" ? <EndServiceCard companyId={company.id} onEnded={() => router.push(`/companies/${company.id}/profile`)} /> : null}
    </div>
  )
}

/** The original form's "End Date": ending a customer's service is a lifecycle action with a reason (an ended engagement is never reopened or deleted). */
function EndServiceCard({ companyId, onEnded }: { companyId: string; onEnded: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  return (
    <Card className="max-w-5xl">
      <CardHeader className="bg-muted/30 py-3 border-b">
        <CardTitle className="text-sm">End this customer&apos;s service</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <form
          className="grid sm:grid-cols-4 gap-4 items-end"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            if (!window.confirm("End this customer's service? This is recorded permanently with its reason and is never reopened or deleted.")) return
            setBusy(true)
            setMessage(null)
            try {
              const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/engagement`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ endedAt: `${String(form.get("endedAt"))}T00:00:00Z`, endReason: String(form.get("endReason")) }),
              })
              if (!response.ok) return setMessage((await response.json().catch(() => null))?.error ?? "The service could not be ended.")
              onEnded()
            } catch {
              setMessage("The service could not be ended.")
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="endedAt">End date</Label>
            <Input id="endedAt" name="endedAt" type="date" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="endReason">Reason</Label>
            <select id="endReason" name="endReason" required className="w-full rounded-md border bg-background px-2 py-2 text-sm">
              {ENGAGEMENT_END_REASONS.map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
          <Button type="submit" variant="outline" disabled={busy}>End service</Button>
          {message ? <p role="alert" className="sm:col-span-4 text-sm text-red-600">{message}</p> : null}
        </form>
      </CardContent>
    </Card>
  )
}
