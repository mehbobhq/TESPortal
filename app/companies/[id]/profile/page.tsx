"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Building2, MapPin, Mail, Phone, Edit2, CheckCircle2, AlertCircle, FileText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/status-badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export default function CompanyProfilePage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const id = params.id as string
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const found = savedCompanies.find((c: any) => c.id === id)
    setCompany(found || null)
    setLoading(false)
  }, [params.id])

  if (loading) return <div className="p-10 text-center">Loading...</div>

  if (!company) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <h2 className="text-2xl font-bold">Company Not Found</h2>
        <Button onClick={() => router.push('/companies')} variant="outline">
          <ArrowLeft className="size-4 mr-2" /> Back to Directory
        </Button>
      </div>
    )
  }

  const isCustomer = company.kind === "Customer"

  const FieldDisplay = ({ label, value }: { label: string, value: any }) => (
    <div className="flex justify-between items-end border-b pb-1">
      <div>
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-foreground mt-0.5">{value || "—"}</p>
      </div>
      <button className="text-muted-foreground hover:text-primary transition-colors">
        <Edit2 className="size-3" />
      </button>
    </div>
  )

  // Helper to format addresses cleanly
  const formatAddress = (prefix: string) => {
    const street = company[`${prefix}_street`]
    const city = company[`${prefix}_city`]
    const state = company[`${prefix}_state`]
    const zip = company[`${prefix}_zip`]
    const country = company[`${prefix}_country`]
    
    if (!street && !city) return null;
    return (
      <div className="text-sm font-medium">
        {street}<br/>
        {city}, {state} {zip}<br/>
        {country === 'CA' ? 'Canada' : country === 'US' ? 'United States' : country}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      
      {/* 1. TOP HEADER & STATS BAR */}
      <div className="bg-card rounded-lg border shadow-sm p-4 flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-lg text-primary">
              <Building2 className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground font-medium">Company</p>
                <StatusBadge tone={company.tone || "ok"}>{company.status}</StatusBadge>
              </div>
              <h1 className="text-2xl font-bold">{company.name}</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">+ Follow</Button>
            <Button variant="outline" size="sm">Edit</Button>
            <Button variant="outline" size="sm">Check Status</Button>
            <Button size="sm">New Case</Button>
          </div>
        </div>

        <div className="flex items-center gap-8 text-sm pt-4 border-t">
          <div><p className="text-muted-foreground text-xs">Operating Region</p><p className="font-medium">{company.region}</p></div>
          <div><p className="text-muted-foreground text-xs">Staff</p><p className="font-medium">0</p></div>
          <div><p className="text-muted-foreground text-xs">Trucks</p><p className="font-medium">0</p></div>
          <div><p className="text-muted-foreground text-xs">Trailers</p><p className="font-medium">0</p></div>
          <div><p className="text-muted-foreground text-xs">Accounts Status</p><p className="font-medium flex items-center gap-1 text-green-600"><CheckCircle2 className="size-3"/> Good</p></div>
          <div><p className="text-muted-foreground text-xs">Item Status</p><p className="font-medium flex items-center gap-1 text-orange-500"><AlertCircle className="size-3"/> Pending</p></div>
        </div>
      </div>

      {/* 2. TAB NAVIGATION */}
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto bg-transparent border-b rounded-none h-auto p-0 space-x-6">
          <TabsTrigger value="dashboard" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Dashboard</TabsTrigger>
          <TabsTrigger value="profile" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Profile</TabsTrigger>
          <TabsTrigger value="contacts" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Contacts</TabsTrigger>
          
          {isCustomer && (
            <>
              <TabsTrigger value="business" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Business</TabsTrigger>
              <TabsTrigger value="insurance" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Insurance</TabsTrigger>
              <TabsTrigger value="transportation" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Transportation</TabsTrigger>
              <TabsTrigger value="tax" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Tax Programs</TabsTrigger>
              <TabsTrigger value="customs" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Customs</TabsTrigger>
              <TabsTrigger value="accounts" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Accounts</TabsTrigger>
              <TabsTrigger value="employees" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Employees</TabsTrigger>
              <TabsTrigger value="equipment" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Equipment</TabsTrigger>
            </>
          )}
          <TabsTrigger value="settings" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Settings</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* 3. MAIN CONTENT GRID */}
      <div className="grid gap-6 lg:grid-cols-3">
        
        {/* LEFT COLUMN: Data Blocks */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          <Card>
            <CardHeader className="bg-muted/30 py-3 border-b">
              <CardTitle className="text-sm flex items-center gap-2"><Building2 className="size-4 text-muted-foreground"/> Company Information</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 grid sm:grid-cols-2 gap-x-8 gap-y-6">
              <FieldDisplay label="Company Name" value={company.name} />
              <FieldDisplay label="Company Record Type" value={company.kind} />
              <FieldDisplay label="DBA" value={company.dba} />
              <FieldDisplay label="Phone" value={company.phone} />
              <FieldDisplay label="Website" value={company.website} />
              <FieldDisplay label="Account Email" value={company.email} />
              <FieldDisplay label="Billing Email" value={company.billingEmail} />
              <FieldDisplay label="Primary Contact" value={company.contact} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-muted/30 py-3 border-b">
              <CardTitle className="text-sm flex items-center gap-2"><MapPin className="size-4 text-muted-foreground"/> Address Information</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 grid sm:grid-cols-2 gap-x-8 gap-y-6">
              <div className="flex flex-col gap-2 border-b pb-2">
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Registered Address</p>
                {formatAddress('reg') || <p className="text-sm text-muted-foreground">—</p>}
              </div>
              <div className="flex flex-col gap-2 border-b pb-2">
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Mailing Address</p>
                {formatAddress('mail') || <p className="text-sm text-muted-foreground">—</p>}
              </div>
              <div className="flex flex-col gap-2 border-b pb-2 sm:col-span-2">
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Yard Address</p>
                {formatAddress('yard') || <p className="text-sm text-muted-foreground">—</p>}
              </div>
            </CardContent>
          </Card>

          {isCustomer && (
            <>
              <Card>
                <CardHeader className="bg-muted/30 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Customer Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-x-8 gap-y-6">
                  <FieldDisplay label="Service Type" value={company.svcType} />
                  <FieldDisplay label="Service Status" value={company.status} />
                  <FieldDisplay label="Start Date" value={company.startDate} />
                  <FieldDisplay label="End Date" value={company.endDate} />
                  <FieldDisplay label="Operating Region" value={company.opRegion} />
                  <FieldDisplay label="Payment Method" value={company.payMethod} />
                  <FieldDisplay label="Cargo Information" value={company.cargoInfo} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="bg-muted/30 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Business Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-x-8 gap-y-6">
                  <FieldDisplay label="Incorporation #" value={company.incorpNo} />
                  <FieldDisplay label="Business #" value={company.businessNo} />
                  <FieldDisplay label="GST / HST" value={company.gstHst} />
                  <FieldDisplay label="EIN #" value={company.ein} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="bg-muted/30 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Carrier Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-x-8 gap-y-6">
                  <FieldDisplay label="MVID / RIN #" value={company.mvid} />
                  <FieldDisplay label="NSC / CVOR #" value={company.nsc} />
                  <FieldDisplay label="US DOT #" value={company.usdot} />
                  <FieldDisplay label="MC #" value={company.mc} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="bg-muted/30 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Tax & Compliance Accounts</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-x-8 gap-y-6">
                  <FieldDisplay label="IRP Account #" value={company.accIrp} />
                  <FieldDisplay label="IFTA Account #" value={company.accIfta} />
                  <FieldDisplay label="NY HUT Account #" value={company.accNyhut} />
                  <FieldDisplay label="NM WDT Account #" value={company.accNm} />
                  <FieldDisplay label="Kentucky KYU #" value={company.accKyu} />
                  <FieldDisplay label="Oregon Account #" value={company.accOr} />
                  <FieldDisplay label="CT DRS Account #" value={company.accCt} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="bg-muted/30 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Customs Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-x-8 gap-y-6">
                  <FieldDisplay label="SCAC" value={company.scac} />
                  <FieldDisplay label="Carrier Code" value={company.carrierCode} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="bg-muted/30 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Fleet Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-x-8 gap-y-6">
                  <FieldDisplay label="Truck GPS Provider" value={company.gpsProvider} />
                  <FieldDisplay label="Fuel Provider" value={company.fuelProvider} />
                  <FieldDisplay label="Assessment Date" value={company.assessmentDate} />
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* RIGHT COLUMN: Sidebar (Activity) */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="py-3 border-b">
              <Tabs defaultValue="activity" className="w-full">
                <TabsList className="w-full justify-start bg-transparent p-0">
                  <TabsTrigger value="activity" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2">Activity</TabsTrigger>
                  <TabsTrigger value="chatter" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2">Chatter</TabsTrigger>
                  <TabsTrigger value="files" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2">Files</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex flex-col gap-6">
                <div className="relative pl-6 border-l-2 border-muted space-y-6">
                  <div className="relative">
                    <span className="absolute -left-[33px] bg-background border-2 border-primary rounded-full p-1 text-primary">
                      <FileText className="size-3" />
                    </span>
                    <p className="text-sm font-medium">Record Created</p>
                    <p className="text-xs text-muted-foreground">{new Date(company.createdAt).toLocaleDateString()} • Admin</p>
                  </div>
                </div>
                <Button variant="outline" className="w-full mt-4">View All Activity</Button>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
