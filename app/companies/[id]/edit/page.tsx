"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Save, Building2, MapPin, ChevronDown } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"

const CARGO_OPTIONS = [
  "General Freight",
  "Specialized Equipment",
  "Household Goods",
  "Temperature-Controlled & Food",
  "Hazardous Materials",
  "Bulk & Other"
]

// Smart Address Component that handles State -> Country auto-fill
const SmartAddressBlock = ({ title, prefix, initialData }: { title: string, prefix: string, initialData: any }) => {
  const [country, setCountry] = useState(initialData[`${prefix}_country`] || "")
  const [region, setRegion] = useState(initialData[`${prefix}_state`] || "")

  // Alphabetized list of North American regions
  const regions = [
    { code: "AB", name: "Alberta", country: "Canada" },
    { code: "AK", name: "Alaska", country: "United States" },
    { code: "AL", name: "Alabama", country: "United States" },
    { code: "AR", name: "Arkansas", country: "United States" },
    { code: "AZ", name: "Arizona", country: "United States" },
    { code: "BC", name: "British Columbia", country: "Canada" },
    { code: "CA", name: "California", country: "United States" },
    { code: "CO", name: "Colorado", country: "United States" },
    { code: "CT", name: "Connecticut", country: "United States" },
    { code: "DC", name: "District of Columbia", country: "United States" },
    { code: "DE", name: "Delaware", country: "United States" },
    { code: "FL", name: "Florida", country: "United States" },
    { code: "GA", name: "Georgia", country: "United States" },
    { code: "HI", name: "Hawaii", country: "United States" },
    { code: "IA", name: "Iowa", country: "United States" },
    { code: "ID", name: "Idaho", country: "United States" },
    { code: "IL", name: "Illinois", country: "United States" },
    { code: "IN", name: "Indiana", country: "United States" },
    { code: "KS", name: "Kansas", country: "United States" },
    { code: "KY", name: "Kentucky", country: "United States" },
    { code: "LA", name: "Louisiana", country: "United States" },
    { code: "MA", name: "Massachusetts", country: "United States" },
    { code: "MB", name: "Manitoba", country: "Canada" },
    { code: "MD", name: "Maryland", country: "United States" },
    { code: "ME", name: "Maine", country: "United States" },
    { code: "MI", name: "Michigan", country: "United States" },
    { code: "MN", name: "Minnesota", country: "United States" },
    { code: "MO", name: "Missouri", country: "United States" },
    { code: "MS", name: "Mississippi", country: "United States" },
    { code: "MT", name: "Montana", country: "United States" },
    { code: "NB", name: "New Brunswick", country: "Canada" },
    { code: "NC", name: "North Carolina", country: "United States" },
    { code: "ND", name: "North Dakota", country: "United States" },
    { code: "NE", name: "Nebraska", country: "United States" },
    { code: "NH", name: "New Hampshire", country: "United States" },
    { code: "NJ", name: "New Jersey", country: "United States" },
    { code: "NL", name: "Newfoundland and Labrador", country: "Canada" },
    { code: "NM", name: "New Mexico", country: "United States" },
    { code: "NS", name: "Nova Scotia", country: "Canada" },
    { code: "NT", name: "Northwest Territories", country: "Canada" },
    { code: "NU", name: "Nunavut", country: "Canada" },
    { code: "NV", name: "Nevada", country: "United States" },
    { code: "NY", name: "New York", country: "United States" },
    { code: "OH", name: "Ohio", country: "United States" },
    { code: "OK", name: "Oklahoma", country: "United States" },
    { code: "ON", name: "Ontario", country: "Canada" },
    { code: "OR", name: "Oregon", country: "United States" },
    { code: "PA", name: "Pennsylvania", country: "United States" },
    { code: "PE", name: "Prince Edward Island", country: "Canada" },
    { code: "QC", name: "Quebec", country: "Canada" },
    { code: "RI", name: "Rhode Island", country: "United States" },
    { code: "SC", name: "South Carolina", country: "United States" },
    { code: "SD", name: "South Dakota", country: "United States" },
    { code: "SK", name: "Saskatchewan", country: "Canada" },
    { code: "TN", name: "Tennessee", country: "United States" },
    { code: "TX", name: "Texas", country: "United States" },
    { code: "UT", name: "Utah", country: "United States" },
    { code: "VA", name: "Virginia", country: "United States" },
    { code: "VT", name: "Vermont", country: "United States" },
    { code: "WA", name: "Washington", country: "United States" },
    { code: "WI", name: "Wisconsin", country: "United States" },
    { code: "WV", name: "West Virginia", country: "United States" },
    { code: "WY", name: "Wyoming", country: "United States" },
    { code: "YT", name: "Yukon", country: "Canada" }
  ].sort((a, b) => a.name.localeCompare(b.name))

  const handleRegionChange = (val: string) => {
    setRegion(val)
    const selected = regions.find(r => r.code === val)
    if (selected) {
      setCountry(selected.country)
    }
  }

  return (
    <div className="space-y-4 border-b pb-6 last:border-0 last:pb-0">
      <h3 className="font-semibold text-sm text-foreground">{title}</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-2 lg:col-span-2">
          <Label>Street Address</Label>
          <Input name={`${prefix}_street`} defaultValue={initialData[`${prefix}_street`] || ""} />
        </div>
        <div className="space-y-2">
          <Label>City</Label>
          <Input name={`${prefix}_city`} defaultValue={initialData[`${prefix}_city`] || ""} />
        </div>
        
        <div className="space-y-2">
          <Label>State/Province</Label>
          <input type="hidden" name={`${prefix}_state`} value={region} />
          <Select value={region} onValueChange={handleRegionChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select region" />
            </SelectTrigger>
            <SelectContent>
              {regions.map((r) => (
                <SelectItem key={r.code} value={r.code}>
                  {r.name} ({r.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>ZIP/Postal Code</Label>
          <Input name={`${prefix}_zip`} defaultValue={initialData[`${prefix}_zip`] || ""} />
        </div>

        <div className="space-y-2">
          <Label>Country</Label>
          <Input 
            name={`${prefix}_country`} 
            value={country} 
            onChange={(e) => setCountry(e.target.value)}
            className="bg-muted/30" 
          />
        </div>
      </div>
    </div>
  )
}

export default function EditCompanyPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  
  // State for the Cargo Multi-Select Dropdown
  const [selectedCargo, setSelectedCargo] = useState<string[]>([])

  useEffect(() => {
    const id = params.id as string
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const found = savedCompanies.find((c: any) => c.id === id)
    
    if (found) {
      setCompany(found)
      // Load their existing cargo types, default to an empty array
      setSelectedCargo(found.cargoTypes || [])
    } else {
      setCompany(null)
    }
    
    setLoading(false)
  }, [params.id])

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    // Safety check: Block save if they haven't selected at least one cargo type
    if (selectedCargo.length === 0) {
      alert("Error: Cargo Information is mandatory. Please select at least one Cargo Type.");
      return;
    }
    
    const formData = new FormData(e.currentTarget)
    const formEntries = Object.fromEntries(formData.entries())
    
    const updatedCompany = {
      ...company,
      ...formEntries,
      name: formEntries.companyName, 
      contact: formEntries.contactPerson || company.contact,
      region: formEntries.opRegion || company.region,
      status: formEntries.status || company.status,
      cargoTypes: selectedCargo, // Save the array to the company profile
    }

    const existingCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const updatedCompaniesList = existingCompanies.map((c: any) => 
      c.id === company.id ? updatedCompany : c
    )
    localStorage.setItem("tes_companies", JSON.stringify(updatedCompaniesList))
    
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
              <Select name="opRegion" defaultValue={company.region || "Canada Only"}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Canada Only">Canada Only</SelectItem>
                  <SelectItem value="US Only">US Only</SelectItem>
                  <SelectItem value="Cross-Border">Cross-Border</SelectItem>
                </SelectContent>
              </Select>
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
            <SmartAddressBlock title="Registered Address" prefix="reg" initialData={company} />
            <SmartAddressBlock title="Mailing Address" prefix="mail" initialData={company} />
            <SmartAddressBlock title="Yard Address" prefix="yard" initialData={company} />
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
                  <Select name="svcType" defaultValue={company.svcType || "Premium"}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Premium">Premium</SelectItem>
                      <SelectItem value="Standard">Standard</SelectItem>
                      <SelectItem value="Basic">Basic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Service Status</Label>
                  <Select name="status" defaultValue={company.status || "Active"}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
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
                  <Select name="payMethod" defaultValue={company.payMethod || "E-Transfer"}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="E-Transfer">E-Transfer</SelectItem>
                      <SelectItem value="Credit Card">Credit Card</SelectItem>
                      <SelectItem value="Wire Transfer">Wire Transfer</SelectItem>
                      <SelectItem value="Cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* THE NEW MULTI-SELECT CARGO DROPDOWN */}
                <div className="space-y-2 flex flex-col">
                  <Label>Cargo Information *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button 
                        variant="outline" 
                        className={`w-full justify-between h-auto min-h-10 px-3 py-2 ${selectedCargo.length === 0 ? "text-muted-foreground" : ""}`}
                      >
                        <div className="flex flex-wrap gap-1 text-left">
                          {selectedCargo.length === 0 && "Select cargo types..."}
                          {selectedCargo.map(cargo => (
                            <Badge variant="secondary" key={cargo} className="text-[10px] font-normal">
                              {cargo}
                            </Badge>
                          ))}
                        </div>
                        <ChevronDown className="size-4 opacity-50 shrink-0" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-2" align="start">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">Select all that apply</p>
                        {CARGO_OPTIONS.map((option) => (
                          <div key={option} className="flex items-center space-x-2 p-1 hover:bg-muted/50 rounded-md transition-colors cursor-pointer" onClick={() => {
                            setSelectedCargo(prev => 
                              prev.includes(option) 
                                ? prev.filter(item => item !== option)
                                : [...prev, option]
                            )
                          }}>
                            <Checkbox checked={selectedCargo.includes(option)} />
                            <Label className="text-sm cursor-pointer">{option}</Label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <input type="hidden" name="cargoTypes" value={JSON.stringify(selectedCargo)} />
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
        <div className="flex justify-end gap-4 mt-2 sticky bottom-4 bg-background/80 p-4 border rounded-lg backdrop-blur shadow-sm z-10">
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
