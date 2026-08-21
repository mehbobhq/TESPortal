"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Save, Building2, MapPin } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export default function EditCompanyPage() {
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

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    const formData = new FormData(e.currentTarget)
    const formEntries = Object.fromEntries(formData.entries())
    
    // Merge new form data with the existing company data
    const updatedCompany = {
      ...company,
      ...formEntries,
      name: formEntries.companyName, 
      contact: formEntries.contactPerson || company.contact,
      region: formEntries.opRegion || company.region,
      status: formEntries.status || company.status,
    }

    // 1. Update Master Companies List
    const existingCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const updatedCompaniesList = existingCompanies.map((c: any) => 
      c.id === company.id ? updatedCompany : c
    )
    localStorage.setItem("tes_companies", JSON.stringify(updatedCompaniesList))
    
    // 2. Update Customers List (if applicable)
    if (company.kind === "Customer") {
      const existingCustomers = JSON.parse(localStorage.getItem("tes_customers") || "[]")
      const updatedCustomersList = existingCustomers.map((c: any) => 
        c.id === company.id ? updatedCompany : c
      )
      localStorage.setItem("tes_customers", JSON.stringify(updatedCustomersList))
    }
    
    router.push(`/companies/${company.id}/profile`)
  }

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <div className="p-10 text-center">Company not found.</div>

  const isCustomer = company.kind === "Customer"

  // Helper component for Addresses to keep code clean
  const AddressBlock = ({ title, prefix }: { title: string, prefix: string }) => (
    <div className="space-y-4 border-b pb-6 last:border-0 last:pb-0">
      <h3 className="font-semibold text-sm text-foreground">{title}</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-2 lg:col-span-2">
          <Label>Street Address</Label>
          <Input name={`${prefix}_street`} defaultValue={company[`${prefix}_street`] || ""} />
        </div>
        <div className="space-y-2">
          <Label>City</Label>
          <Input name={`${prefix}_city`} defaultValue={company[`${prefix}_city`] || ""} />
        </div>
        <div className="space-y-2">
          <Label>State/Province</Label>
          <Input name={`${prefix}_state`} defaultValue={company[`${prefix}_state`] || ""} />
        </div>
        <div className="space-y-2">
          <Label>ZIP/Postal Code</Label>
          <Input name={`${prefix}_zip`} defaultValue={company[`${prefix}_zip`] || ""} />
        </div>
        <div className="space-y-2">
          <Label>Country</Label>
          <Input name={`${prefix}_country`} defaultValue={company[`${prefix}_country`] || ""} />
        </div>
      </div>
    </div>
  )

  return (
    <div className="pb-10 flex flex-col gap-6">
      <PageHeader
        title={`Edit: ${company.name}`}
        description="Update company records and information."
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 size-4" /> Cancel
          </Button>
        }
      />

      <form onSubmit={handleUpdate} className="flex flex-col gap-6 max-w-5xl">
        
        {/* CORE INFO */}
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground"/> Core Information
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name</Label>
              <Input id="companyName" name="companyName" defaultValue={company.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dba">DBA</Label>
              <Input id="dba" name="dba" defaultValue={company.dba || ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPerson">Primary Contact</Label>
              <Input id="contactPerson" name="contactPerson" defaultValue={company.contact || ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={company.phone || ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" name="website" defaultValue={company.website || ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Account Email</Label>
              <Input id="email" name="email" type="email" defaultValue={company.email || ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="billingEmail">Billing Email</Label>
              <Input id="billingEmail" name="billingEmail" type="email" defaultValue={company.billingEmail || ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="opRegion">Operating Region</Label>
              <Input id="opRegion" name="opRegion" defaultValue={company.region || ""} />
            </div>
          </CardContent>
        </Card>

        {/* ADDRESSES */}
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="size-4 text-muted-foreground"/> Address Information
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <AddressBlock title="Registered Address" prefix="reg" />
            <AddressBlock title="Mailing Address" prefix="mail" />
            <AddressBlock title="Yard Address" prefix="yard" />
          </CardContent>
        </Card>

        {isCustomer && (
          <>
            {/* CUSTOMER INFO */}
            <Card>
              <CardHeader className="bg-muted/30 py-3 border-b">
                <CardTitle className="text-sm text-primary">Customer Information</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label>Service Type</Label>
                  <Input name="svcType" defaultValue={company.svcType || ""} />
                </div>
                <div className="space-y-2">
                  <Label>Service Status</Label>
                  {/* Using a hidden input to preserve the value if we don't want a full select dropdown here, or just a standard input */}
                  <Input name="status" defaultValue={company.status || "Active"} />
                </div>
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input name="startDate" type="date" defaultValue={company.startDate || ""} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input name="endDate" type="date" defaultValue={company.endDate || ""} />
                </div>
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Input name="payMethod" defaultValue={company.payMethod || ""} />
                </div>
                <div className="space-y-2">
                  <Label>Cargo Information</Label>
                  <Input name="cargoInfo" defaultValue={company.cargoInfo || ""} />
                </div>
              </CardContent>
            </Card>

            {/* BUSINESS & CARRIER INFO */}
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="bg-muted/30 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Business Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-6">
                  <div className="space-y-2"><Label>Incorporation #</Label><Input name="incorpNo" defaultValue={company.incorpNo || ""} /></div>
                  <div className="space-y-2"><Label>Business #</Label><Input name="businessNo" defaultValue={company.businessNo || ""} /></div>
                  <div className="space-y-2"><Label>GST / HST</Label><Input name="gstHst" defaultValue={company.gstHst || ""} /></div>
                  <div className="space-y-2"><Label>EIN #</Label><Input name="ein" defaultValue={company.ein || ""} /></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="bg-muted/30 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Carrier Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-6">
                  <div className="space-y-2"><Label>MVID / RIN #</Label><Input name="mvid" defaultValue={company.mvid || ""} /></div>
                  <div className="space-y-2"><Label>NSC / CVOR #</Label><Input name="nsc" defaultValue={company.nsc || ""} /></div>
                  <div className="space-y-2"><Label>US DOT #</Label><Input name="usdot" defaultValue={company.usdot || ""} /></div>
                  <div className="space-y-2"><Label>MC #</Label><Input name="mc" defaultValue={company.mc || ""} /></div>
                </CardContent>
              </Card>
            </div>

            {/* TAX ACCOUNTS */}
            <Card>
              <CardHeader className="bg-muted/30 py-3 border-b">
                <CardTitle className="text-sm text-primary">Tax & Compliance Accounts</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid sm:grid-cols-3 gap-6">
                <div className="space-y-2"><Label>IRP Account #</Label><Input name="accIrp" defaultValue={company.accIrp || ""} /></div>
                <div className="space-y-2"><Label>IFTA Account #</Label><Input name="accIfta" defaultValue={company.accIfta || ""} /></div>
                <div className="space-y-2"><Label>NY HUT Account #</Label><Input name="accNyhut" defaultValue={company.accNyhut || ""} /></div>
                <div className="space-y-2"><Label>NM WDT Account #</Label><Input name="accNm" defaultValue={company.accNm || ""} /></div>
                <div className="space-y-2"><Label>Kentucky KYU #</Label><Input name="accKyu" defaultValue={company.accKyu || ""} /></div>
                <div className="space-y-2"><Label>Oregon Account #</Label><Input name="accOr" defaultValue={company.accOr || ""} /></div>
                <div className="space-y-2"><Label>CT DRS Account #</Label><Input name="accCt" defaultValue={company.accCt || ""} /></div>
              </CardContent>
            </Card>

            {/* CUSTOMS & FLEET */}
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="bg-muted/30 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Customs Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-6">
                  <div className="space-y-2"><Label>SCAC</Label><Input name="scac" defaultValue={company.scac || ""} /></div>
                  <div className="space-y-2"><Label>Carrier Code</Label><Input name="carrierCode" defaultValue={company.carrierCode || ""} /></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="bg-muted/30 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Fleet Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-6">
                  <div className="space-y-2"><Label>Truck GPS Provider</Label><Input name="gpsProvider" defaultValue={company.gpsProvider || ""} /></div>
                  <div className="space-y-2"><Label>Fuel Provider</Label><Input name="fuelProvider" defaultValue={company.fuelProvider || ""} /></div>
                  <div className="space-y-2 sm:col-span-2"><Label>Assessment Date</Label><Input name="assessmentDate" type="date" defaultValue={company.assessmentDate || ""} /></div>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-4 mt-2 sticky bottom-4 bg-background/80 p-4 border rounded-lg backdrop-blur shadow-sm">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Discard Changes
          </Button>
          <Button type="submit">
            <Save className="mr-2 size-4" />
            Save Updates
          </Button>
        </div>
      </form>
    </div>
  )
}
