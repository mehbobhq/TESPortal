"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Building2, MapPin, CheckCircle2, AlertCircle, FileText, Calendar } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/status-badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

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

  // --- Dynamic Visibility Logic ---
  const isCustomer = company.kind === "Customer"
  const opRegion = company.region || "Canada Only"
  const isCanada = opRegion === "Canada Only" || opRegion === "Cross-Border"
  const isUS = opRegion === "US Only" || opRegion === "Cross-Border"
  const showCustoms = opRegion === "Cross-Border"

  const FieldDisplay = ({ label, value }: { label: string, value: any }) => (
    <div className="flex flex-col border-b pb-1.5">
      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm font-medium text-foreground">{value || "—"}</p>
    </div>
  )

  const formatAddress = (prefix: string) => {
    const street = company[`${prefix}_street`]
    const city = company[`${prefix}_city`]
    const state = company[`${prefix}_state`]
    const zip = company[`${prefix}_zip`]
    const country = company[`${prefix}_country`]
    
    if (!street && !city && !state) return null;
    return (
      <div className="text-sm font-medium leading-snug">
        {street}<br/>
        {city && state ? `${city}, ${state} ${zip}` : ""}<br/>
        {country}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-10">
      
      {/* 1. HEADER & STATS BAR */}
      <div className="bg-card rounded-lg border shadow-sm p-4 flex flex-col gap-4">
        <div className="flex justify-between items-start">
          
          <div className="flex items-start gap-4">
            <div className="flex shrink-0 size-16 items-center justify-center rounded-lg border bg-muted/30 text-muted-foreground">
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
            <Button variant="outline" size="sm" onClick={() => router.push(`/companies/${company.id}/edit`)}>
              Edit
            </Button>
            <Button variant="outline" size="sm">Check Status</Button>
            <Button size="sm">New Case</Button>
          </div>
        </div>

        {/* COMPACT STATS BAR */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t">
          <div className="flex flex-wrap items-center gap-x-6 sm:gap-x-8 gap-y-3 text-sm">
            <div><p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Operating Region</p><p className="font-medium">{company.region}</p></div>
            <div><p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Staff</p><p className="font-medium">0</p></div>
            <div><p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Trucks</p><p className="font-medium">0</p></div>
            <div><p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Trailers</p><p className="font-medium">0</p></div>
            <div><p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Accounts</p><p className="font-medium flex items-center gap-1 text-green-600"><CheckCircle2 className="size-3.5"/> Good</p></div>
            <div><p className="text-muted-foreground text-[11px] uppercase tracking-wider mb-0.5">Items</p><p className="font-medium flex items-center gap-1 text-orange-500"><AlertCircle className="size-3.5"/> Pending</p></div>
          </div>

          <div className="bg-muted/40 border rounded-md px-4 py-1.5 text-right shrink-0">
            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-0.5">Assessment Date</p>
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
          
          <Card>
            <CardHeader className="bg-muted/30 py-2 border-b">
              <CardTitle className="text-sm flex items-center gap-2"><Building2 className="size-4 text-muted-foreground"/> Company Information</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
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
            <CardHeader className="bg-muted/30 py-2 border-b">
              <CardTitle className="text-sm flex items-center gap-2"><MapPin className="size-4 text-muted-foreground"/> Address Information</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid sm:grid-cols-3 gap-x-6 gap-y-4">
              <div className="flex flex-col gap-1 border-b pb-2">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Registered Address</p>
                {formatAddress('reg') || <p className="text-sm text-muted-foreground">—</p>}
              </div>
              
              {isCustomer && (
                <>
                  <div className="flex flex-col gap-1 border-b pb-2">
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Mailing Address</p>
                    {formatAddress('mail') || <p className="text-sm text-muted-foreground">—</p>}
                  </div>
                  <div className="flex flex-col gap-1 border-b pb-2">
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Yard Address</p>
                    {formatAddress('yard') || <p className="text-sm text-muted-foreground">—</p>}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {isCustomer && (
            <>
              <Card>
                <CardHeader className="bg-muted/30 py-2 border-b">
                  <CardTitle className="text-sm text-primary">Customer Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
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
                <CardHeader className="bg-muted/30 py-2 border-b">
                  <CardTitle className="text-sm text-primary">Business Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                  <FieldDisplay 
                    label={opRegion === "Canada Only" ? "Canadian Corporate Number" : opRegion === "US Only" ? "State File / Charter Number" : "Incorporation # / State File"} 
                    value={company.incorpNo} 
                  />
                  <FieldDisplay 
                    label={opRegion === "Canada Only" ? "CRA Business Number (BN)" : opRegion === "US Only" ? "IRS Employer ID (EIN)" : "Business Number / EIN"} 
                    value={company.businessNo} 
                  />
                  <FieldDisplay 
                    label={opRegion === "Canada Only" ? "GST / HST Account" : opRegion === "US Only" ? "State Sales Tax ID" : "Tax Registration #"} 
                    value={company.gstHst} 
                  />
                  <FieldDisplay label="Registered Province/State" value={company.regCorpState} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="bg-muted/30 py-2 border-b">
                  <CardTitle className="text-sm text-primary">Carrier Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
                  {isCanada && (
                    <>
                      <FieldDisplay label="MVID / RIN #" value={company.mvid} />
                      <FieldDisplay label="NSC / CVOR #" value={company.nsc} />
                    </>
                  )}
                  {isUS && (
                    <>
                      <FieldDisplay label="US DOT #" value={company.usdot} />
                      <FieldDisplay label="MC #" value={company.mc} />
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="bg-muted/30 py-2 border-b">
                  <CardTitle className="text-sm text-primary">Tax & Compliance Accounts</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
                  <FieldDisplay label="IRP Account #" value={company.accIrp} />
                  <FieldDisplay label="IFTA Account #" value={company.accIfta} />
                  {isUS && (
                    <>
                      <FieldDisplay label="NY HUT Account #" value={company.accNyhut} />
                      <FieldDisplay label="NM WDT Account #" value={company.accNm} />
                      <FieldDisplay label="Kentucky KYU #" value={company.accKyu} />
                      <FieldDisplay label="Oregon Account #" value={company.accOr} />
                      <FieldDisplay label="CT DRS Account #" value={company.accCt} />
                    </>
                  )}
                </CardContent>
              </Card>

              <div className="grid sm:grid-cols-2 gap-4">
                {showCustoms && (
                  <Card>
                    <CardHeader className="bg-muted/30 py-2 border-b">
                      <CardTitle className="text-sm text-primary">Customs Information</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 grid gap-x-6 gap-y-4">
                      <FieldDisplay label="SCAC" value={company.scac} />
                      <FieldDisplay label="Carrier Code" value={company.carrierCode} />
                    </CardContent>
                  </Card>
                )}

                <Card className={!showCustoms ? "sm:col-span-2" : ""}>
                  <CardHeader className="bg-muted/30 py-2 border-b">
                    <CardTitle className="text-sm text-primary">Fleet Information</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 grid sm:grid-cols-2 gap-x-6 gap-y-4">
                    <FieldDisplay label="Truck GPS Provider" value={company.gpsProvider} />
                    <FieldDisplay label="Fuel Provider" value={company.fuelProvider} />
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>

        {/* RIGHT COLUMN: Sticky Sidebar */}
        <div className="lg:col-span-1 sticky top-16 flex flex-col gap-4">
          <Card className="shadow-sm">
            <Tabs defaultValue="activity" className="w-full">
              <CardHeader className="py-1.5 border-b px-0 bg-muted/10">
                <TabsList className="w-full justify-start bg-transparent p-0 px-4 space-x-4">
                  <TabsTrigger value="activity" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 py-1.5 text-xs uppercase tracking-wider">Activity</TabsTrigger>
                  <TabsTrigger value="notes" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 py-1.5 text-xs uppercase tracking-wider">Notes</TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent className="p-0">
                
                <TabsContent value="activity" className="m-0 p-4 flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <div className="flex shrink-0 items-center justify-center size-7 rounded-full border border-primary/20 text-primary bg-primary/5 mt-0.5">
                      <FileText className="size-3.5" />
                    </div>
                    <div className="flex flex-col">
                      <p className="text-sm font-medium">Record Created</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {company.createdAt ? new Date(company.createdAt).toISOString().split('T')[0] : "Unknown Date"} • Admin
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="w-full mt-1 text-xs">View All Activity</Button>
                </TabsContent>

                <TabsContent value="notes" className="m-0 p-4 flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <Textarea 
                      placeholder="Add a quick note..." 
                      className="min-h-[100px] resize-none text-sm p-3"
                    />
                    <Button size="sm" className="w-full text-xs">Save Note</Button>
                  </div>
                  <div className="pt-3 border-t mt-1">
                    <p className="text-[11px] text-muted-foreground text-center italic">No prior notes.</p>
                  </div>
                </TabsContent>

              </CardContent>
            </Tabs>
          </Card>
        </div>

      </div>
    </div>
  )
}
