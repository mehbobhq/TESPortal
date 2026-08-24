"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Plus,
  ScanLine,
  Sparkles,
  Receipt,
  FileSpreadsheet,
  MapPin,
  Calendar,
  AlertCircle,
  FileCheck
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// --- REUSABLE OCR UPLOAD ZONE ---
const DocumentUploadZone = ({
  title,
  description,
  isAutoFill
}: {
  title: string
  description: string
  isAutoFill?: boolean
}) => (
  <div
    className={`w-full border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center transition-colors cursor-pointer group ${
      isAutoFill
        ? "border-blue-500/30 bg-blue-50/50 hover:bg-blue-50 dark:bg-blue-950/10 dark:hover:bg-blue-900/20"
        : "border-primary/20 bg-primary/5 hover:bg-primary/10"
    }`}
  >
    <div
      className={`p-2 rounded-full shadow-sm mb-2 group-hover:scale-110 transition-transform ${
        isAutoFill ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400" : "bg-background text-primary"
      }`}
    >
      {isAutoFill ? <Sparkles className="size-4" /> : <ScanLine className="size-4" />}
    </div>
    <h3 className="font-semibold text-xs text-foreground mb-1">{title}</h3>
    <p className="text-[10px] text-muted-foreground max-w-sm mb-3 leading-tight">{description}</p>
    <Button
      type="button"
      variant={isAutoFill ? "default" : "secondary"}
      size="sm"
      className={`pointer-events-none h-6 text-[10px] px-2 ${isAutoFill ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`}
    >
      Browse Files
    </Button>
  </div>
)

export default function TaxFilingsPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  // UI Form Toggle States
  const [showAddIFTA, setShowAddIFTA] = useState(false)
  const [showAddHVUT, setShowAddHVUT] = useState(false)
  const [showAddStateTax, setShowAddStateTax] = useState(false)
  const [showAddProvTax, setShowAddProvTax] = useState(false)

  // Data States
  const [iftaFilings, setIftaFilings] = useState<any[]>([])
  const [hvutFilings, setHvutFilings] = useState<any[]>([])
  const [stateWeightFilings, setStateWeightFilings] = useState<any[]>([])
  const [provFuelFilings, setProvFuelFilings] = useState<any[]>([])

  useEffect(() => {
    const id = params.id as string
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const found = savedCompanies.find((c: any) => c.id === id)
    setCompany(found || null)
    setLoading(false)
  }, [params.id])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <div className="p-10 text-center">Company Not Found</div>

  // --- REGULATORY JURISDICTION ENGINE ---
  const isCanada = company.regCorpCountry === "Canada"
  const isUS = company.regCorpCountry === "United States"
  const isCrossBorder = company.region === "Cross-Border"
  const isCanadaOnly = isCanada && company.region === "Canada Only"
  const isUSOnly = isUS && company.region === "US Only"

  // 1. IFTA: Universally applicable across all commercial motor carriers
  const needsIFTA = true

  // 2. HVUT / IRS Form 2290: US domestic or any cross-border carrier entering US highways
  const needsHVUT = isUS || isCrossBorder

  // 3. US State Weight-Distance & Highway Use Taxes (NY HUT, NM WDT, KYU, OR WMT, CT HUT)
  const needsUSStateTaxes = isUS || isCrossBorder

  // 4. Canadian Provincial / Fuel Charge Registrations & Tobacco
  const needsCanadianFuelTaxes = isCanada || (isUS && isCrossBorder)

  const generateId = (prefix: string) => `${company.id}-${prefix}-${Math.floor(1000 + Math.random() * 9000)}`

  // --- SAVE HANDLERS ---
  const handleSaveIFTA = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setIftaFilings([
      {
        id: generateId("IFTA"),
        quarter: formData.get("quarter"),
        year: formData.get("year"),
        netTaxDue: formData.get("netTaxDue"),
        filedDate: formData.get("filedDate"),
        status: "Filed"
      },
      ...iftaFilings
    ])
    setShowAddIFTA(false)
  }

  const handleSaveHVUT = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setHvutFilings([
      {
        id: generateId("2290"),
        taxPeriod: formData.get("taxPeriod"),
        vinCount: formData.get("vinCount"),
        totalTaxPaid: formData.get("totalTaxPaid"),
        watermarkReceived: formData.get("watermarkReceived") === "yes",
        filedDate: formData.get("filedDate"),
        status: "Verified"
      },
      ...hvutFilings
    ])
    setShowAddHVUT(false)
  }

  const handleSaveStateTax = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setStateWeightFilings([
      {
        id: generateId("STX"),
        jurisdiction: formData.get("jurisdiction"),
        accountNo: formData.get("accountNo"),
        period: formData.get("period"),
        milesReported: formData.get("milesReported"),
        amountPaid: formData.get("amountPaid"),
        filedDate: formData.get("filedDate"),
        status: "Active"
      },
      ...stateWeightFilings
    ])
    setShowAddStateTax(false)
  }

  const handleSaveProvTax = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setProvFuelFilings([
      {
        id: generateId("CAN-TX"),
        taxType: formData.get("taxType"),
        accountNo: formData.get("accountNo"),
        period: formData.get("period"),
        status: "Compliant"
      },
      ...provFuelFilings
    ])
    setShowAddProvTax(false)
  }

  return (
    <div className="flex flex-col gap-6 pb-10 max-w-6xl">
      {/* 1. HEADER & COMPLIANCE CONTEXT */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/companies/${company.id}/profile`)}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tax & Highway Use Filings</h1>
            <p className="text-muted-foreground text-sm">
              {company.name} ({company.id})
            </p>
          </div>
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider block mb-1">
                Registered Origin
              </span>
              <span className="font-semibold flex items-center gap-1.5">
                <Building2 className="size-3.5 text-primary" /> {company.regCorpState || "Unknown"},{" "}
                {company.regCorpCountry || "Unknown"}
              </span>
            </div>
            <div className="h-8 w-px bg-border" />
            <div>
              <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider block mb-1">
                Operating Scope
              </span>
              <span className="font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-primary" /> {company.region}
              </span>
            </div>
            <div className="h-8 w-px bg-border" />
            <div>
              <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider block mb-1">
                Active Tax Regimes
              </span>
              <span className="font-medium text-xs text-muted-foreground">
                {isCanadaOnly && "IFTA • Canadian Provincial / Fuel Charge"}
                {isCanada && isCrossBorder && "IFTA • HVUT 2290 • US State Weight-Mile (NY, NM, KY, OR, CT)"}
                {isUSOnly && "IFTA • HVUT 2290 • US Highway Use • TX/AR Motor Fuel"}
                {isUS && isCrossBorder && "IFTA • HVUT 2290 • US Highway Use • Canadian Fuel Charge"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. IFTA QUARTERLY RETURNS (Universal) */}
      {needsIFTA && (
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-primary" /> International Fuel Tax Agreement (IFTA)
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Quarterly fuel tax reconciliations across base jurisdictions.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                onClick={() => setShowAddIFTA(true)}
              >
                <ScanLine className="size-4 mr-1" /> Scan IFTA Return
              </Button>
              <Button size="sm" onClick={() => setShowAddIFTA(true)}>
                <Plus className="size-4 mr-1" /> Manual Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {showAddIFTA && (
              <form onSubmit={handleSaveIFTA} className="p-6 bg-primary/5 border-b border-primary/20">
                <h4 className="font-semibold text-sm text-primary mb-4">Record Quarterly IFTA Filing</h4>

                <div className="mb-6">
                  <DocumentUploadZone
                    isAutoFill={true}
                    title="Mandatory: IFTA Quarterly Return / Schedule Summary"
                    description="Drop filing receipt here. OCR will extract total distance, taxable gallons, and net tax paid."
                  />
                </div>

                <div className="grid sm:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>Filing Quarter *</Label>
                    <Select name="quarter" required defaultValue="Q1">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Q1">Q1 (Jan - Mar)</SelectItem>
                        <SelectItem value="Q2">Q2 (Apr - Jun)</SelectItem>
                        <SelectItem value="Q3">Q3 (Jul - Sep)</SelectItem>
                        <SelectItem value="Q4">Q4 (Oct - Dec)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Filing Year *</Label>
                    <Input name="year" defaultValue={new Date().getFullYear().toString()} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Net Tax Paid / (Refund)</Label>
                    <Input name="netTaxDue" placeholder="e.g. $420.50" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Date Filed *</Label>
                    <Input name="filedDate" type="date" required />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowAddIFTA(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Save IFTA Record</Button>
                </div>
              </form>
            )}

            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                <div className="col-span-3">Record ID</div>
                <div className="col-span-3">Quarter / Period</div>
                <div className="col-span-3">Net Tax Position</div>
                <div className="col-span-2">Date Filed</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {iftaFilings.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No IFTA quarterly filings recorded. Use OCR upload to record Q1-Q4 settlements.
                </div>
              ) : (
                iftaFilings.map((r) => (
                  <div key={r.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-muted/20 transition-colors">
                    <div className="col-span-3 font-mono text-xs">{r.id}</div>
                    <div className="col-span-3 font-medium">
                      {r.quarter} {r.year}
                    </div>
                    <div className="col-span-3 font-mono text-xs font-semibold text-foreground">{r.netTaxDue}</div>
                    <div className="col-span-2 text-xs text-muted-foreground">{r.filedDate}</div>
                    <div className="col-span-1 text-right">
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        Edit
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. IRS FORM 2290 / HVUT (US & Cross-Border Carriers) */}
      {needsHVUT && (
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Receipt className="size-4 text-primary" /> Heavy Vehicle Use Tax (HVUT / IRS Form 2290)
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Mandatory for commercial vehicles operating at 55,000+ lbs on US public highways.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                onClick={() => setShowAddHVUT(true)}
              >
                <ScanLine className="size-4 mr-1" /> Scan Form 2290 Receipt
              </Button>
              <Button size="sm" onClick={() => setShowAddHVUT(true)}>
                <Plus className="size-4 mr-1" /> Manual Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {showAddHVUT && (
              <form onSubmit={handleSaveHVUT} className="p-6 bg-primary/5 border-b border-primary/20">
                <h4 className="font-semibold text-sm text-primary mb-4">Record IRS Form 2290 Schedule 1</h4>

                <div className="mb-6">
                  <DocumentUploadZone
                    isAutoFill={true}
                    title="Mandatory: IRS E-File Stamped Schedule 1"
                    description="Upload official IRS watermarked Schedule 1 receipt to auto-verify VIN fleet lists."
                  />
                </div>

                <div className="grid sm:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>Tax Period *</Label>
                    <Input name="taxPeriod" placeholder="July 1, 2026 - June 30, 2027" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Total Vehicles Reported *</Label>
                    <Input name="vinCount" type="number" placeholder="e.g. 12" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Total Tax Paid</Label>
                    <Input name="totalTaxPaid" placeholder="e.g. $6,600.00" required />
                  </div>
                  <div className="space-y-2">
                    <Label>IRS Watermark Stamped? *</Label>
                    <Select name="watermarkReceived" defaultValue="yes">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">Yes (Stamped / Verified)</SelectItem>
                        <SelectItem value="no">Pending IRS Acceptance</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Payment / Filing Date *</Label>
                    <Input name="filedDate" type="date" required />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowAddHVUT(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Save 2290 Record</Button>
                </div>
              </form>
            )}

            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                <div className="col-span-3">Filing ID</div>
                <div className="col-span-3">Tax Period</div>
                <div className="col-span-2">Vehicles (VINs)</div>
                <div className="col-span-2">IRS Schedule 1 Status</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>

              {hvutFilings.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No IRS Form 2290 records uploaded. Upload stamped Schedule 1 to maintain highway registration clearance.
                </div>
              ) : (
                hvutFilings.map((r) => (
                  <div key={r.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-muted/20 transition-colors">
                    <div className="col-span-3 font-mono text-xs">{r.id}</div>
                    <div className="col-span-3 font-medium text-xs">{r.taxPeriod}</div>
                    <div className="col-span-2 text-xs">{r.vinCount} Units</div>
                    <div className="col-span-2">
                      <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 bg-green-50">
                        <FileCheck className="size-3 mr-1" /> Watermarked
                      </Badge>
                    </div>
                    <div className="col-span-2 text-right">
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        Edit
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4. US STATE WEIGHT-DISTANCE & HIGHWAY USE TAXES (NY, NM, KY, OR, CT, AR, TX) */}
      {needsUSStateTaxes && (
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="size-4 text-primary" /> US State Highway Use & Weight-Distance Filings
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                NY HUT, NM WDT, Kentucky KYU, Oregon WMT, Connecticut HUT, Arkansas & Texas Motor Fuel.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                onClick={() => setShowAddStateTax(true)}
              >
                <ScanLine className="size-4 mr-1" /> Scan State Return
              </Button>
              <Button size="sm" onClick={() => setShowAddStateTax(true)}>
                <Plus className="size-4 mr-1" /> Manual Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {showAddStateTax && (
              <form onSubmit={handleSaveStateTax} className="p-6 bg-primary/5 border-b border-primary/20">
                <h4 className="font-semibold text-sm text-primary mb-4">Add State Weight-Distance Return</h4>

                <div className="mb-6">
                  <DocumentUploadZone
                    isAutoFill={true}
                    title="Upload State Tax Filing Confirmation"
                    description="Drop state portal receipt (e.g. OSCAR Oregon, NY OSC, NM TAP) for automated data entry."
                  />
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>State / Tax Program *</Label>
                    <Select name="jurisdiction" required defaultValue="NY HUT">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NY HUT">New York Highway Use Tax (NY HUT)</SelectItem>
                        <SelectItem value="NM WDT">New Mexico Weight Distance (NM WDT)</SelectItem>
                        <SelectItem value="KYU">Kentucky Weight Distance (KYU)</SelectItem>
                        <SelectItem value="OR WMT">Oregon Weight-Mile Tax (OR WMT)</SelectItem>
                        <SelectItem value="CT HUT">Connecticut Highway Use Fee (CT HUT)</SelectItem>
                        {isUS && <SelectItem value="AR MFT">Arkansas Motor Fuel Tax (AR MFT)</SelectItem>}
                        {isUS && <SelectItem value="TX MFT">Texas Motor-Fuel Tax (TX MFT)</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>State Account / Decal #</Label>
                    <Input name="accountNo" placeholder="e.g. HUT-8839120" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Filing Reporting Period *</Label>
                    <Input name="period" placeholder="e.g. Monthly / Q3 2026" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Taxable Miles Reported</Label>
                    <Input name="milesReported" placeholder="e.g. 4,820 miles" />
                  </div>
                  <div className="space-y-2">
                    <Label>Total Remitted</Label>
                    <Input name="amountPaid" placeholder="e.g. $184.20" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Filing Date *</Label>
                    <Input name="filedDate" type="date" required />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowAddStateTax(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Save State Return</Button>
                </div>
              </form>
            )}

            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                <div className="col-span-3">State Program</div>
                <div className="col-span-3">Account Number</div>
                <div className="col-span-2">Filing Period</div>
                <div className="col-span-2">Amount Paid</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>

              {stateWeightFilings.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No state highway use returns recorded. Add filings for NY, NM, KY, OR, or CT as miles are accumulated.
                </div>
              ) : (
                stateWeightFilings.map((r) => (
                  <div key={r.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-muted/20 transition-colors">
                    <div className="col-span-3 font-semibold text-foreground flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {r.jurisdiction}
                      </Badge>
                    </div>
                    <div className="col-span-3 font-mono text-xs">{r.accountNo}</div>
                    <div className="col-span-2 text-xs">{r.period}</div>
                    <div className="col-span-2 font-mono text-xs font-medium text-foreground">{r.amountPaid}</div>
                    <div className="col-span-2 text-right">
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        Edit
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 5. CANADIAN PROVINCIAL MOTOR-FUEL & FUEL CHARGE REGISTRATIONS */}
      {needsCanadianFuelTaxes && (
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="size-4 text-primary" /> Canadian Provincial Fuel Charges & Tobacco Tax
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Provincial fuel tax registrations, Federal fuel charge, and Ontario Tobacco Tax records.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => setShowAddProvTax(true)}>
                <ScanLine className="size-4 mr-1" /> Scan Registration
              </Button>
              <Button size="sm" onClick={() => setShowAddProvTax(true)}>
                <Plus className="size-4 mr-1" /> Manual Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {showAddProvTax && (
              <form onSubmit={handleSaveProvTax} className="p-6 bg-primary/5 border-b border-primary/20">
                <h4 className="font-semibold text-sm text-primary mb-4">Add Canadian Tax Registration / Return</h4>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Registration / Filing Type *</Label>
                    <Select name="taxType" required defaultValue="Canadian Fuel Charge">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Canadian Fuel Charge">Federal Fuel Charge Registration</SelectItem>
                        <SelectItem value="Provincial Motor Fuel">Provincial Motor-Fuel Tax (BC / AB / SK / MB / QC)</SelectItem>
                        {isCanada && <SelectItem value="Ontario Tobacco Tax">Ontario Tobacco Tax (Carrier Permit)</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Account / Permit ID *</Label>
                    <Input name="accountNo" placeholder="e.g. FCR-10029381" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Validity / Filing Cycle</Label>
                    <Input name="period" placeholder="Annual / Continuous" defaultValue="Annual" required />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowAddProvTax(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Save Record</Button>
                </div>
              </form>
            )}

            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                <div className="col-span-4">Tax Program</div>
                <div className="col-span-4">Account / Permit ID</div>
                <div className="col-span-2">Cycle</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>

              {provFuelFilings.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No provincial fuel charge or excise tax registrations recorded.
                </div>
              ) : (
                provFuelFilings.map((r) => (
                  <div key={r.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-muted/20 transition-colors">
                    <div className="col-span-4 font-medium text-foreground">{r.taxType}</div>
                    <div className="col-span-4 font-mono text-xs">{r.accountNo}</div>
                    <div className="col-span-2 text-xs">{r.period}</div>
                    <div className="col-span-2 text-right">
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        Edit
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
