"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Save, AlertTriangle, XCircle, Building2, MapPin, CheckCircle2 } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// Standard Levenshtein distance for fuzzy matching
const getLevenshteinDistance = (a: string, b: string) => {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
  for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) == a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
      }
    }
  }
  return matrix[b.length][a.length];
}

// Reusable Regions Array
const REGIONS = [
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

const SmartAddressBlock = ({ title, prefix, isAdditional = false }: { title: string, prefix: string, isAdditional?: boolean }) => {
  const [country, setCountry] = useState("")
  const [region, setRegion] = useState("")

  const handleRegionChange = (val: string) => {
    setRegion(val)
    const selected = REGIONS.find(r => r.code === val)
    if (selected) setCountry(selected.country)
  }

  return (
    <div className={`space-y-4 pb-6 last:pb-0 ${isAdditional ? 'bg-muted/30 p-5 rounded-lg border' : 'border-b last:border-0'}`}>
      <h3 className={`font-semibold text-sm ${isAdditional ? 'text-primary' : 'text-foreground'}`}>{title}</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-2 lg:col-span-2">
          <Label>Street Address</Label>
          <Input name={`${prefix}_street`} placeholder="123 Main St" className={isAdditional ? "bg-background" : ""} />
        </div>
        <div className="space-y-2">
          <Label>City</Label>
          <Input name={`${prefix}_city`} placeholder="City" className={isAdditional ? "bg-background" : ""} />
        </div>
        
        <div className="space-y-2">
          <Label>State/Province</Label>
          <input type="hidden" name={`${prefix}_state`} value={region} />
          {/* CRITICAL FIX: Added `|| undefined` to prevent Radix UI empty string crash */}
          <Select value={region || undefined} onValueChange={handleRegionChange}>
            <SelectTrigger className={isAdditional ? "bg-background" : ""}>
              <SelectValue placeholder="Select region" />
            </SelectTrigger>
            <SelectContent>
              {REGIONS.map((r) => (
                <SelectItem key={r.code} value={r.code}>
                  {r.name} ({r.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>ZIP/Postal Code</Label>
          <Input name={`${prefix}_zip`} placeholder="Postal Code" className={isAdditional ? "bg-background" : ""} />
        </div>

        <div className="space-y-2">
          <Label>Country</Label>
          <Input 
            name={`${prefix}_country`} 
            value={country} 
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Auto-fills"
            className="bg-muted/50 font-medium text-muted-foreground" 
            readOnly
          />
        </div>
      </div>
    </div>
  )
}

export default function NewCompanyPage() {
  const router = useRouter()
  const [recordId, setRecordId] = useState("")
  const [selectedType, setSelectedType] = useState<string>("")
  const [companyName, setCompanyName] = useState("")
  const [opRegion, setOpRegion] = useState("Canada Only")
  
  // States for dynamic inputs
  const [businessNumber, setBusinessNumber] = useState("")
  const [businessRegion, setBusinessRegion] = useState("")
  const [businessCountry, setBusinessCountry] = useState("")

  const [exactMatchError, setExactMatchError] = useState<string | null>(null)
  const [fuzzyWarning, setFuzzyWarning] = useState<{name: string, id: string} | null>(null)
  const [overrideFuzzy, setOverrideFuzzy] = useState(false)

  useEffect(() => {
    const randomNum = Math.floor(10000 + Math.random() * 90000)
    setRecordId(`CMP-${randomNum}`)
  }, [])

  useEffect(() => {
    if (companyName.trim().length < 3) {
      setExactMatchError(null)
      setFuzzyWarning(null)
      setOverrideFuzzy(false)
      return
    }
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const exactMatch = savedCompanies.find((c: any) => c.name.toLowerCase() === companyName.toLowerCase())
    if (exactMatch) {
      setExactMatchError(`A company with the exact name "${exactMatch.name}" already exists (ID: ${exactMatch.id}).`)
      setFuzzyWarning(null)
      return
    }
    setExactMatchError(null)

    let foundFuzzy = null
    for (const c of savedCompanies) {
      const distance = getLevenshteinDistance(companyName.toLowerCase(), c.name.toLowerCase())
      const maxLength = Math.max(companyName.length, c.name.length)
      const similarity = ((maxLength - distance) / maxLength) * 100
      if (similarity > 80) {
        foundFuzzy = { name: c.name, id: c.id }
        break 
      }
    }
    setFuzzyWarning(foundFuzzy)
    if (!foundFuzzy) setOverrideFuzzy(false)
  }, [companyName])

  const handleBusinessNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '') 
    if (opRegion === "US Only") {
      if (val.length > 2) val = val.slice(0, 2) + '-' + val.slice(2, 9)
    } else {
      val = val.slice(0, 9)
    }
    setBusinessNumber(val)
  }

  const handleBusinessRegionChange = (val: string) => {
    setBusinessRegion(val)
    const selected = REGIONS.find(r => r.code === val)
    if (selected) setBusinessCountry(selected.country)
  }

  const handleCreateCompany = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault() 
    if (exactMatchError || (fuzzyWarning && !overrideFuzzy)) return; 
    if (!selectedType) {
      alert("Please select a Company Type before saving.")
      return
    }

    const formData = new FormData(e.currentTarget)
    const formEntries = Object.fromEntries(formData.entries())
    
    const newCompany = {
      ...formEntries,
      id: recordId,
      name: formEntries.companyName as string,
      kind: selectedType,
      region: opRegion,
      contact: (formEntries.contactPerson as string) || "N/A",
      status: (formEntries.status as string) || "Active",
      tone: "ok", 
      createdAt: new Date().toISOString()
    }

    const existingCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    localStorage.setItem("tes_companies", JSON.stringify([newCompany, ...existingCompanies]))
    
    if (selectedType === "Customer") {
      const existingCustomers = JSON.parse(localStorage.getItem("tes_customers") || "[]")
      localStorage.setItem("tes_customers", JSON.stringify([newCompany, ...existingCustomers]))
    }
    router.push(`/companies/${recordId}/profile`)
  }

  // --- Dynamic Visibility Logic ---
  const isCustomer = selectedType === "Customer"
  const isCanada = opRegion === "Canada Only" || opRegion === "Cross-Border"
  const isUS = opRegion === "US Only" || opRegion === "Cross-Border"
  const showCustoms = opRegion === "Cross-Border" 

  return (
    <div className="pb-10 flex flex-col gap-6">
      <PageHeader
        title="Create Entity Record"
        description="Add a new company, carrier, or partner to the master directory."
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 size-4" /> Cancel
          </Button>
        }
      />

      <form onSubmit={handleCreateCompany} className="flex flex-col gap-8 max-w-5xl">
        
        {/* ========================================== */}
        {/* SECTION 1: CORE IDENTITY (Always Default)  */}
        {/* ========================================== */}
        <div className="flex flex-col gap-6">
          <Card className="border-primary/30 shadow-sm">
            <CardHeader className="bg-primary/5 py-4 border-b">
              <CardTitle className="text-lg">Entity Setup</CardTitle>
              <CardDescription>Define the record ID and primary relationship type.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 grid sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>System Record ID</Label>
                <Input value={recordId} disabled className="bg-muted font-mono" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyType" className="text-primary font-medium">Company Record Type *</Label>
                {/* CRITICAL FIX: Added `|| undefined` */}
                <Select value={selectedType || undefined} onValueChange={setSelectedType} required>
                  <SelectTrigger className="border-primary/30 focus:ring-primary/20">
                    <SelectValue placeholder="Select entity type..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Customer">Customer</SelectItem>
                    <SelectItem value="Prospect">Prospect</SelectItem>
                    <SelectItem value="Owner Operator">Owner Operator</SelectItem>
                    <SelectItem value="Service Provider">Service Provider</SelectItem>
                    <SelectItem value="Finance/ Leasing Company">Finance/ Leasing Company</SelectItem>
                    <SelectItem value="Insurance Broker">Insurance Broker</SelectItem>
                    <SelectItem value="Insurance Company">Insurance Company</SelectItem>
                    <SelectItem value="Workers Insurance">Workers Insurance</SelectItem>
                    <SelectItem value="Employee Reference">Employee Reference</SelectItem>
                    <SelectItem value="Government Agency">Government Agency</SelectItem>
                    <SelectItem value="Sub Contractor">Sub Contractor</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-muted/30 py-3 border-b">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="size-4 text-muted-foreground"/> Core Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input 
                  id="companyName" name="companyName" 
                  placeholder="e.g. Power Way Logistics Inc"
                  value={companyName} onChange={(e) => setCompanyName(e.target.value)} required 
                />
                {exactMatchError && (
                  <div className="flex items-center gap-2 mt-2 text-destructive bg-destructive/10 p-2 rounded text-sm">
                    <XCircle className="size-4 shrink-0" /><p>{exactMatchError}</p>
                  </div>
                )}
                {fuzzyWarning && !exactMatchError && (
                  <div className="flex flex-col gap-2 mt-2 bg-orange-500/10 border border-orange-500/20 p-3 rounded text-sm">
                    <div className="flex items-start gap-2 text-orange-600 dark:text-orange-400">
                      <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                      <p><strong>Potential Duplicate:</strong> "{fuzzyWarning.name}" sounds similar.</p>
                    </div>
                    <div className="flex items-center space-x-2 pl-6">
                      <Checkbox id="override" checked={overrideFuzzy} onCheckedChange={(checked) => setOverrideFuzzy(checked === true)} />
                      <label htmlFor="override" className="text-xs font-medium text-foreground">I confirm this is a separate company.</label>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2"><Label htmlFor="dba">DBA</Label><Input id="dba" name="dba" placeholder="Doing Business As" /></div>
              <div className="space-y-2"><Label htmlFor="contactPerson">Primary Contact</Label><Input id="contactPerson" name="contactPerson" placeholder="Full Name" /></div>
              <div className="space-y-2"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" placeholder="+1 (555) 000-0000" /></div>
              <div className="space-y-2"><Label htmlFor="website">Website</Label><Input id="website" name="website" placeholder="https://" /></div>
              <div className="space-y-2"><Label htmlFor="email">Account Email</Label><Input id="email" name="email" type="email" placeholder="contact@example.com" /></div>
              <div className="space-y-2"><Label htmlFor="billingEmail">Billing Email</Label><Input id="billingEmail" name="billingEmail" type="email" placeholder="billing@example.com" /></div>
              
              <div className="space-y-2">
                <Label htmlFor="opRegion" className="text-primary font-medium">Operating Region *</Label>
                <input type="hidden" name="opRegion" value={opRegion} />
                {/* CRITICAL FIX: Added `|| undefined` */}
                <Select value={opRegion || undefined} onValueChange={setOpRegion} required>
                  <SelectTrigger className="border-primary/30"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Canada Only">Canada Only</SelectItem>
                    <SelectItem value="US Only">US Only</SelectItem>
                    <SelectItem value="Cross-Border">Cross-Border</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>


        {/* ========================================================= */}
        {/* SECTION 2: CUSTOMER COMPLIANCE PROFILE (Grey Box Add-on)  */}
        {/* ========================================================= */}
        {isCustomer && (
          <div className="flex flex-col gap-6 p-6 bg-muted/20 border-2 border-dashed rounded-xl relative">
            
            {/* Elegant Header - Reverted to guaranteed icons to prevent crashes */}
            <div className="absolute -top-3 left-6 bg-background px-3 flex items-center gap-2 text-sm font-semibold text-primary/80 border rounded-full shadow-sm">
              <CheckCircle2 className="size-3.5" />
              Compliance & Services Profile
            </div>

            <Card className="shadow-none border-border/50">
              <CardHeader className="bg-muted/10 py-3 border-b">
                <CardTitle className="text-sm flex items-center gap-2"><Building2 className="size-4 text-muted-foreground"/> Customer Information</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label>Service Type</Label>
                  <Select name="svcType" defaultValue="Premium">
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
                  <Select name="status" defaultValue="Active">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Start Date</Label><Input name="startDate" type="date" /></div>
                <div className="space-y-2"><Label>End Date</Label><Input name="endDate" type="date" /></div>
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select name="payMethod" defaultValue="E-Transfer">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="E-Transfer">E-Transfer</SelectItem>
                      <SelectItem value="Credit Card">Credit Card</SelectItem>
                      <SelectItem value="Wire Transfer">Wire Transfer</SelectItem>
                      <SelectItem value="Cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Cargo Information</Label><Input name="cargoInfo" placeholder="e.g. Dry Van, Flatbed" /></div>
              </CardContent>
            </Card>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* DYNAMIC BUSINESS INFORMATION */}
              <Card className="shadow-none border-border/50">
                <CardHeader className="bg-muted/10 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Business Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-6">
                  
                  {/* NEW: Registered Province Logic */}
                  <div className="space-y-2">
                    <Label>Registered Province/State</Label>
                    <input type="hidden" name="regCorpState" value={businessRegion} />
                    {/* CRITICAL FIX: Added `|| undefined` */}
                    <Select value={businessRegion || undefined} onValueChange={handleBusinessRegionChange}>
                      <SelectTrigger><SelectValue placeholder="Select origin" /></SelectTrigger>
                      <SelectContent>
                        {REGIONS.map((r) => (
                          <SelectItem key={r.code} value={r.code}>{r.name} ({r.code})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Country (Auto-fill)</Label>
                    <Input name="regCorpCountry" value={businessCountry} readOnly className="bg-muted/50 text-muted-foreground font-medium" placeholder="Auto-fills" />
                  </div>

                  {/* Dynamic Incorp */}
                  <div className="space-y-2 sm:col-span-2">
                    <Label>{opRegion === "Canada Only" ? "Canadian Corporate Number" : opRegion === "US Only" ? "State File / Charter Number" : "Incorporation # / State File"}</Label>
                    <Input 
                      name="incorpNo" 
                      placeholder={opRegion === "Canada Only" ? "e.g., 1234567-8" : opRegion === "US Only" ? "e.g., 6543210" : ""}
                      pattern={opRegion === "Canada Only" ? "^[A-Za-z0-9\\s-]{5,15}$" : opRegion === "US Only" ? "^[A-Za-z0-9-]{6,12}$" : undefined}
                    />
                  </div>

                  {/* Dynamic BN/EIN */}
                  <div className="space-y-2 sm:col-span-2">
                    <Label>{opRegion === "Canada Only" ? "CRA Business Number (BN)" : opRegion === "US Only" ? "IRS Employer Identification Number (EIN)" : "Business Number / EIN"}</Label>
                    <Input 
                      name="businessNo" 
                      value={businessNumber}
                      onChange={handleBusinessNumberChange}
                      placeholder={opRegion === "Canada Only" ? "123456789" : opRegion === "US Only" ? "12-3456789" : ""}
                      pattern={opRegion === "Canada Only" ? "^\\d{9}$" : opRegion === "US Only" ? "^\\d{2}-\\d{7}$|^\\d{9}$" : undefined}
                    />
                  </div>

                  {/* Dynamic Tax Reg */}
                  <div className="space-y-2 sm:col-span-2">
                    <Label>{opRegion === "Canada Only" ? "GST / HST Program Account" : opRegion === "US Only" ? "State Sales Tax ID" : "Tax Registration #"}</Label>
                    <Input 
                      name="gstHst" 
                      placeholder={opRegion === "Canada Only" ? "123456789 RT 0001" : opRegion === "US Only" ? "e.g., ST-123456-A" : ""}
                      pattern={opRegion === "Canada Only" ? "^\\d{9}\\s*[rR][tT]\\s*\\d{4}$" : opRegion === "US Only" ? "^[A-Za-z0-9-]{4,20}$" : undefined}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* DYNAMIC CARRIER INFORMATION */}
              <Card className="shadow-none border-border/50">
                <CardHeader className="bg-muted/10 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Carrier Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-6">
                  {isCanada && (
                    <>
                      <div className="space-y-2"><Label>MVID / RIN #</Label><Input name="mvid" /></div>
                      <div className="space-y-2"><Label>NSC / CVOR #</Label><Input name="nsc" /></div>
                    </>
                  )}
                  {isUS && (
                    <>
                      <div className="space-y-2"><Label>US DOT #</Label><Input name="usdot" /></div>
                      <div className="space-y-2"><Label>MC #</Label><Input name="mc" /></div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* DYNAMIC TAX ACCOUNTS */}
            <Card className="shadow-none border-border/50">
              <CardHeader className="bg-muted/10 py-3 border-b">
                <CardTitle className="text-sm text-primary">Tax & Compliance Accounts</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-2"><Label>IRP Account #</Label><Input name="accIrp" /></div>
                <div className="space-y-2"><Label>IFTA Account #</Label><Input name="accIfta" /></div>
                {isUS && (
                  <>
                    <div className="space-y-2"><Label>NY HUT Account #</Label><Input name="accNyhut" /></div>
                    <div className="space-y-2"><Label>NM WDT Account #</Label><Input name="accNm" /></div>
                    <div className="space-y-2"><Label>Kentucky KYU #</Label><Input name="accKyu" /></div>
                    <div className="space-y-2"><Label>Oregon Account #</Label><Input name="accOr" /></div>
                    <div className="space-y-2"><Label>CT DRS Account #</Label><Input name="accCt" /></div>
                  </>
                )}
              </CardContent>
            </Card>

            <div className="grid lg:grid-cols-2 gap-6">
              {showCustoms && (
                <Card className="shadow-none border-border/50">
                  <CardHeader className="bg-muted/10 py-3 border-b">
                    <CardTitle className="text-sm text-primary">Customs Information</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 grid sm:grid-cols-2 gap-6">
                    <div className="space-y-2"><Label>SCAC</Label><Input name="scac" /></div>
                    <div className="space-y-2"><Label>Carrier Code</Label><Input name="carrierCode" /></div>
                  </CardContent>
                </Card>
              )}

              <Card className={`shadow-none border-border/50 ${!showCustoms ? "lg:col-span-2" : ""}`}>
                <CardHeader className="bg-muted/10 py-3 border-b">
                  <CardTitle className="text-sm text-primary">Fleet Information</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-6">
                  <div className="space-y-2"><Label>Truck GPS Provider</Label><Input name="gpsProvider" /></div>
                  <div className="space-y-2"><Label>Fuel Provider</Label><Input name="fuelProvider" /></div>
                  <div className="space-y-2 sm:col-span-2"><Label>Assessment Date</Label><Input name="assessmentDate" type="date" /></div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ========================================== */}
        {/* SECTION 3: ADDRESSES (Moved to the bottom) */}
        {/* ========================================== */}
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/30 py-3 border-b">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="size-4 text-muted-foreground"/> Address Information
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            
            {/* Registered Address - Always Default Styling */}
            <SmartAddressBlock title="Registered Address" prefix="reg" />
            
            {/* Mailing/Yard Addresses - Grey Background Styling to show they are "Additional" */}
            {isCustomer && (
              <>
                <SmartAddressBlock title="Mailing Address" prefix="mail" isAdditional={true} />
                <SmartAddressBlock title="Yard Address" prefix="yard" isAdditional={true} />
              </>
            )}
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-end gap-4 sticky bottom-4 bg-background/80 p-4 border rounded-lg backdrop-blur shadow-sm z-10">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Discard
          </Button>
          <Button type="submit" disabled={!!exactMatchError || (!!fuzzyWarning && !overrideFuzzy)}>
            <Save className="mr-2 size-4" />
            Create Record
          </Button>
        </div>
      </form>
    </div>
  )
}
