"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Building2, ArrowLeft, Mail, Phone, MapPin, Edit } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/status-badge"

export default function CompanyDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Read the ID from the URL (e.g. "CMP-00001")
    const id = params.id as string
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    
    // Find the specific company
    const found = savedCompanies.find((c: any) => c.id === id)
    setCompany(found || null)
    setLoading(false)
  }, [params.id])

  if (loading) return <div className="p-10 text-center">Loading...</div>

  // If the URL has an ID that doesn't exist in our storage
  if (!company) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <h2 className="text-2xl font-bold">Company Not Found</h2>
        <p className="text-muted-foreground">The record {params.id} does not exist or has been deleted.</p>
        <Button onClick={() => router.push('/companies')} variant="outline">
          <ArrowLeft className="size-4 mr-2" /> Back to Directory
        </Button>
      </div>
    )
  }

  return (
    <div className="pb-10">
      <PageHeader
        title={company.name}
        description={`${company.id} • ${company.kind}`}
        actions={
          <>
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 size-4" /> Back
            </Button>
            <Button>
              <Edit className="mr-2 size-4" /> Edit Record
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3 mt-6">
        
        {/* Main Details Column */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Core Information</CardTitle>
              <StatusBadge tone={company.tone || "ok"}>{company.status || "Active"}</StatusBadge>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground mb-1">Company Type</p>
                <p className="font-medium">{company.kind}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Operating Region</p>
                <p className="font-medium">{company.region !== "N/A" ? company.region : "Not Specified"}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Date Added</p>
                <p className="font-medium">{new Date(company.createdAt).toLocaleDateString()}</p>
              </div>
            </CardContent>
          </Card>

          {/* Placeholder for the deeper details we will build later */}
          <Card>
            <CardHeader>
              <CardTitle>Extended Data</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground bg-muted/30 p-6 rounded-md border border-dashed m-6 mt-0 text-center">
              Full fields (Carrier Info, Accounts, Customs) will populate here once backend storage is connected.
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Column */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Primary Contact</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 text-primary p-2 rounded-md">
                  <Building2 className="size-4" />
                </div>
                <div>
                  <p className="font-medium">{company.contact}</p>
                  <p className="text-muted-foreground text-xs">Main Contact</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="size-4 text-muted-foreground" />
                <span>contact@example.com</span>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="size-4 text-muted-foreground" />
                <span>+1 (555) 000-0000</span>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="size-4 text-muted-foreground mt-0.5" />
                <span>123 Main St, City, State, 12345, Country</span>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
