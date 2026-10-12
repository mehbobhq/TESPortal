"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Save, Building2 } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type EditableCompany = {
  id: string
  companyName: string
  dba: string
  incorpNo: string
  businessNo: string
  ein: string
}

const DEFERRED_SECTIONS = [
  "Contact person, phone, website and email addresses",
  "Registered, mailing and yard addresses",
  "Customer service type, status, dates, payment method and cargo types",
  "Carrier numbers (USDOT, MC, NSC, MVID) — managed in Authorities",
  "Tax programme accounts — managed in Tax Filing registrations",
  "Customs codes and fleet providers",
]

export default function EditCompanyPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<EditableCompany | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = params.id as string
    let cancelled = false
    fetch(`/api/companies/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? (await response.json()).company : null))
      .catch(() => null)
      .then((found) => {
        if (cancelled) return
        setCompany(found ?? null)
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
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error ?? "Unable to update company.")
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
  if (!company) return <div className="p-10 text-center">Company not found.</div>

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
              <Label htmlFor="ein">EIN (IRS)</Label>
              <Input id="ein" name="ein" defaultValue={company.ein} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b">
            <CardTitle className="text-sm">Not yet available</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-xs text-muted-foreground">
            <p className="mb-2">These fields have no canonical PostgreSQL storage yet and cannot be edited here:</p>
            <ul className="list-disc pl-5 space-y-1">
              {DEFERRED_SECTIONS.map((section) => (
                <li key={section}>{section}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            <Save className="mr-2 size-4" /> {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  )
}
