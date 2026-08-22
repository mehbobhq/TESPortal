"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Building2, Plus, FileText, UploadCloud, FileArchive, CheckCircle2, ScanLine } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// --- REUSABLE OCR UPLOAD ZONE ---
// This is the standard component that will trigger your future 3/4 screen OCR overlay.
const DocumentUploadZone = ({ title, description }: { title: string, description: string }) => (
  <div className="w-full mt-4 border-2 border-dashed border-primary/20 rounded-xl p-8 flex flex-col items-center justify-center text-center bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer group">
    <div className="p-3 bg-background rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform">
      <ScanLine className="size-6 text-primary" />
    </div>
    <h3 className="font-semibold text-foreground mb-1">{title}</h3>
    <p className="text-xs text-muted-foreground max-w-sm mb-4">{description}</p>
    <Button variant="secondary" size="sm" className="pointer-events-none">
      <UploadCloud className="size-4 mr-2" /> Browse Files
    </Button>
  </div>
)

export default function BusinessPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  
  // UI States
  const [isEditingIncorp, setIsEditingIncorp] = useState(false)
  const [showAddShareholder, setShowAddShareholder] = useState(false)
  const [showAddReturn, setShowAddReturn] = useState(false)
  const [showAddCra, setShowAddCra] = useState(false)
  const [showAddEin, setShowAddEin] = useState(false)
  const [showAddGst, setShowAddGst] = useState(false)
  const [showAddSalesTax, setShowAddSalesTax] = useState(false)

  // Data States
  const [incorpDate, setIncorpDate] = useState("")
  const [shareholders, setShareholders] = useState<any[]>([])
  const [annualReturns, setAnnualReturns] = useState<any[]>([])
  const [craRecords, setCraRecords] = useState<any[]>([])
  const [einRecords, setEinRecords] = useState<any[]>([])
  const [gstRecords, setGstRecords] = useState<any[]>([])
  const [salesTaxRecords, setSalesTaxRecords] = useState<any[]>([])

  useEffect(() => {
    const id = params.id as string
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const found = savedCompanies.find((c: any) => c.id === id)
    setCompany(found || null)
    
    // Load saved incorp date if it exists
    if (found && found.incorpDate) {
      setIncorpDate(found.incorpDate)
    }
    
    setLoading(false)
  }, [params.id])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <div className="p-10 text-center">Company Not Found</div>

  // --- REGION LOGIC ---
  const isCanadaRegistered = company.regCorpCountry === "Canada"
  const isUSRegistered = company.regCorpCountry === "United States"
  const isCrossBorder = company.region === "Cross-Border"

  const needsCanadianTaxes = isCanadaRegistered || isCrossBorder
  const needsUSTaxes = isUSRegistered || isCrossBorder

  // --- SAVE HANDLERS ---
  const generateId = (prefix: string) => `${company.id}-${prefix}-${Math.floor(1000 + Math.random() * 9000)}`

  const handleSaveIncorp = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // In a real app, you'd save this to Supabase/localStorage here.
    setIsEditingIncorp(false)
  }

  const handleSaveShareholder = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const newRecord = {
      id: generateId("SHR"),
      name: formData.get("name"),
      shares: formData.get("shares"),
      address: formData.get("address"),
      isArchived: false
    }
    setShareholders([...shareholders, newRecord])
    setShowAddShareholder(false)
  }

  const handleSaveReturn = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const newRecord = {
      id: generateId("RTN"),
      dueDate: formData.get("dueDate"),
      filedDate: formData.get("filedDate"),
      filedBy: formData.get("filedBy"),
      isArchived: false
    }
    setAnnualReturns([...annualReturns, newRecord])
    setShowAddReturn(false)
  }

  const handleSaveTaxRecord = (e: React.FormEvent<HTMLFormElement>, prefix: string, setState: any, stateArray: any[], closeForm: any) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const newRecord = {
      id: generateId(prefix),
      accountNo: formData.get("accountNo"),
      obtainedDate: formData.get("obtainedDate"),
      obtainedBy: formData.get("obtainedBy"),
      isArchived: false
    }
    setState([...stateArray, newRecord])
    closeForm(false)
  }

  return (
    <div className="flex flex-col gap-6 pb-10 max-w-6xl">
      
      {/* HEADER & COMPLIANCE CONTEXT */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/companies/${company.id}/profile`)}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Business & Corporate Records</h1>
            <p className="text-muted-foreground text-sm">{company.name} ({company.id})</p>
          </div>
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider block mb-1">Registered Origin</span>
              <span className="font-semibold flex items-center gap-1.5"><Building2 className="size-3.5 text-primary"/> {company.regCorpState || "Unknown"}, {company.regCorpCountry || "Unknown"}</span>
            </div>
            <div className="h-8 w-px bg-border"></div>
            <div>
              <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider block mb-1">Operating Region</span>
              <span className="font-semibold flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-primary"/> {company.region}</span>
            </div>
          </div>
        </div>
      </div>

      {/* INCORPORATION SUMMARY */}
      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground"/> Incorporation Information
          </CardTitle>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIsEditingIncorp(!isEditingIncorp)}>
            {isEditingIncorp ? "Cancel" : "Edit"}
          </Button>
        </CardHeader>
        <CardContent className="pt-6">
          {isEditingIncorp ? (
            <form onSubmit={handleSaveIncorp} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6 pb-6 border-b">
              <div className="space-y-2"><Label>Record ID</Label><Input value={company.id} disabled className="bg-muted" /></div>
              <div className="space-y-2">
                <Label>{isCanadaRegistered ? "Corporate Number" : "State File Number"}</Label>
                <Input defaultValue={company.incorpNo || ""} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label>Incorporation Date</Label>
                <Input 
                  type="date" 
                  value={incorpDate}
                  onChange={(e) => setIncorpDate(e.target.value)}
                  required 
                />
              </div>
              <div className="space-y-2"><Label>Jurisdiction</Label><Input value={`${company.regCorpState}, ${company.regCorpCountry}`} disabled className="bg-muted" /></div>
              <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
                <Button type="submit" size="sm">Save Updates</Button>
              </div>
            </form>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="space-y-1"><p className="text-xs text-muted-foreground font-medium uppercase">Record ID</p><p className="text-sm font-mono font-medium">{company.id}</p></div>
              <div className="space-y-1"><p className="text-xs text-muted-foreground font-medium uppercase">{isCanadaRegistered ? "Corporate Number" : "State File Number"}</p><p className="text-sm font-medium">{company.incorpNo || "—"}</p></div>
              <div className="space-y-1"><p className="text-xs text-muted-foreground font-medium uppercase">Incorporation Date</p><p className="text-sm font-medium">{incorpDate || "—"}</p></div>
              <div className="space-y-1"><p className="text-xs text-muted-foreground font-medium uppercase">Jurisdiction</p><p className="text-sm font-medium">{company.regCorpState}, {company.regCorpCountry}</p></div>
            </div>
          )}
          
          <DocumentUploadZone 
            title="Corporate Documents"
            description={
              isCanadaRegistered 
                ? "Upload Articles of Incorporation, Certificate of Status, etc. for OCR scanning." 
                : isUSRegistered 
                  ? "Upload State Charter, Articles of Incorporation, etc. for OCR scanning." 
                  : "Upload corporate formation documents for OCR scanning."
            }
          />
        </CardContent>
      </Card>

      {/* DIRECTORS & SHAREHOLDERS */}
      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">Directors & Shareholders</CardTitle>
            <CardDescription className="text-xs mt-1">Ownership structure and control records.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowAddShareholder(!showAddShareholder)} variant={showAddShareholder ? "outline" : "default"}>
            {showAddShareholder ? "Cancel" : <><Plus className="size-4 mr-1"/> Add Record</>}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {showAddShareholder && (
            <form onSubmit={handleSaveShareholder} className="p-6 bg-muted/10 border-b">
              <h4 className="font-semibold text-sm mb-4">Add Shareholder / Director</h4>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Full Name</Label><Input name="name" placeholder="John Doe" required /></div>
                <div className="space-y-2"><Label>Percent Shares (%)</Label><Input name="shares" type="number" placeholder="50" required /></div>
                <div className="space-y-2 sm:col-span-2"><Label>Address</Label><Input name="address" placeholder="123 Main St..." required /></div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button type="button" variant="outline" onClick={() => setShowAddShareholder(false)}>Cancel</Button>
                <Button type="submit">Save Record</Button>
              </div>
            </form>
          )}

          <div className="divide-y text-sm">
            <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider">
              <div className="col-span-3">Record ID</div>
              <div className="col-span-3">Name</div>
              <div className="col-span-2">Shares</div>
              <div className="col-span-3">Address</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>
            {shareholders.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No shareholder or director records found.</div>
            ) : (
              shareholders.filter(s => !s.isArchived).map((shr) => (
                <div key={shr.id} className="grid grid-cols-12 gap-4 p-4 items-center">
                  <div className="col-span-3 font-mono text-xs">{shr.id}</div>
                  <div className="col-span-3 font-medium">{shr.name}</div>
                  <div className="col-span-2">{shr.shares}%</div>
                  <div className="col-span-3 text-muted-foreground text-xs truncate" title={shr.address}>{shr.address}</div>
                  <div className="col-span-1 text-right flex justify-end gap-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* ANNUAL RETURNS */}
      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">Annual Returns</CardTitle>
            <CardDescription className="text-xs mt-1">Historical ledger of corporate filings.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowAddReturn(!showAddReturn)} variant={showAddReturn ? "outline" : "default"}>
            {showAddReturn ? "Cancel" : <><Plus className="size-4 mr-1"/> Add Filing</>}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {showAddReturn && (
            <div className="p-6 bg-muted/10 border-b">
              <form onSubmit={handleSaveReturn}>
                <h4 className="font-semibold text-sm mb-4">Add Annual Return</h4>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-2"><Label>Due Date</Label><Input name="dueDate" type="date" required /></div>
                  <div className="space-y-2"><Label>Filed Date</Label><Input name="filedDate" type="date" required /></div>
                  <div className="space-y-2"><Label>Filed By</Label><Input name="filedBy" placeholder="Admin/Accountant" required /></div>
                </div>
                
                <DocumentUploadZone 
                  title="Upload Filing Document"
                  description="Drop your filed annual return document here for OCR scanning and safe storage."
                />

                <div className="flex justify-end gap-2 mt-4">
                  <Button type="button" variant="outline" onClick={() => setShowAddReturn(false)}>Cancel</Button>
                  <Button type="submit">Save Filing</Button>
                </div>
              </form>
            </div>
          )}

          <div className="divide-y text-sm">
            <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider">
              <div className="col-span-3">Record ID</div>
              <div className="col-span-2">Due Date</div>
              <div className="col-span-2">Filed Date</div>
              <div className="col-span-2">Filed By</div>
              <div className="col-span-3 text-right">Actions</div>
            </div>
            {annualReturns.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No annual returns filed yet.</div>
            ) : (
              annualReturns.filter(r => !r.isArchived).map((rtn) => (
                <div key={rtn.id} className="grid grid-cols-12 gap-4 p-4 items-center">
                  <div className="col-span-3 font-mono text-xs">{rtn.id}</div>
                  <div className="col-span-2">{rtn.dueDate}</div>
                  <div className="col-span-2 font-medium text-green-600">{rtn.filedDate}</div>
                  <div className="col-span-2 text-muted-foreground">{rtn.filedBy}</div>
                  <div className="col-span-3 text-right flex justify-end gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs"><UploadCloud className="size-3 mr-1"/> Upload</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* DYNAMIC TAX LEDGERS */}
      <div className="grid lg:grid-cols-2 gap-6">
        
        {needsCanadianTaxes && (
          <Card>
            <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-primary">CRA Business Number</CardTitle>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setShowAddCra(!showAddCra)}>
                {showAddCra ? "Cancel" : <><Plus className="size-3 mr-1"/> Add</>}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {showAddCra && (
                <div className="p-4 bg-muted/10 border-b text-sm">
                  <form onSubmit={(e) => handleSaveTaxRecord(e, "CRA", setCraRecords, craRecords, setShowAddCra)}>
                    <div className="space-y-3">
                      <div className="space-y-1"><Label>CRA Business No</Label><Input name="accountNo" required /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label>Obtained Date</Label><Input name="obtainedDate" type="date" required /></div>
                        <div className="space-y-1"><Label>Obtained By</Label><Input name="obtainedBy" required /></div>
                      </div>
                      <Button type="submit" size="sm" className="w-full">Save CRA Number</Button>
                    </div>
                  </form>
                </div>
              )}
              {craRecords.length === 0 ? (
                <div className="p-4 flex flex-col gap-4 text-sm text-center text-muted-foreground py-8">
                  <FileText className="size-8 mx-auto opacity-20" />
                  <p>No records added.</p>
                </div>
              ) : (
                <div className="divide-y text-xs">
                  {craRecords.filter(r => !r.isArchived).map((rec) => (
                    <div key={rec.id} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="font-mono">{rec.id}</p>
                        <p className="font-semibold text-sm">{rec.accountNo}</p>
                      </div>
                      <div className="text-right text-muted-foreground">
                        <p>{rec.obtainedDate}</p>
                        <p>{rec.obtainedBy}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {needsUSTaxes && (
          <Card>
            <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-primary">IRS EIN Letters</CardTitle>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setShowAddEin(!showAddEin)}>
                {showAddEin ? "Cancel" : <><Plus className="size-3 mr-1"/> Add</>}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {showAddEin && (
                <div className="p-4 bg-muted/10 border-b text-sm">
                  <form onSubmit={(e) => handleSaveTaxRecord(e, "EIN", setEinRecords, einRecords, setShowAddEin)}>
                    <div className="space-y-3">
                      <div className="space-y-1"><Label>EIN Number</Label><Input name="accountNo" required /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label>Obtained Date</Label><Input name="obtainedDate" type="date" required /></div>
                        <div className="space-y-1"><Label>Obtained By</Label><Input name="obtainedBy" required /></div>
                      </div>
                      
                      <DocumentUploadZone 
                        title="Upload IRS Letter"
                        description="Drop your CP-575 or SS-4 confirmation letter here for OCR processing."
                      />
                      
                      <Button type="submit" size="sm" className="w-full mt-2">Save EIN</Button>
                    </div>
                  </form>
                </div>
              )}
              {einRecords.length === 0 ? (
                <div className="p-4 flex flex-col gap-4 text-sm text-center text-muted-foreground py-8">
                  <FileText className="size-8 mx-auto opacity-20" />
                  <p>No records added.</p>
                </div>
              ) : (
                <div className="divide-y text-xs">
                  {einRecords.filter(r => !r.isArchived).map((rec) => (
                    <div key={rec.id} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="font-mono">{rec.id}</p>
                        <p className="font-semibold text-sm">{rec.accountNo}</p>
                      </div>
                      <div className="text-right text-muted-foreground">
                        <p>{rec.obtainedDate}</p>
                        <p>{rec.obtainedBy}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {needsCanadianTaxes && (
          <Card>
            <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-primary">GST / HST Account</CardTitle>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setShowAddGst(!showAddGst)}>
                {showAddGst ? "Cancel" : <><Plus className="size-3 mr-1"/> Add</>}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {showAddGst && (
                <div className="p-4 bg-muted/10 border-b text-sm">
                  <form onSubmit={(e) => handleSaveTaxRecord(e, "GST", setGstRecords, gstRecords, setShowAddGst)}>
                    <div className="space-y-3">
                      <div className="space-y-1"><Label>Account No</Label><Input name="accountNo" required /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label>Obtained Date</Label><Input name="obtainedDate" type="date" required /></div>
                        <div className="space-y-1"><Label>Obtained By</Label><Input name="obtainedBy" required /></div>
                      </div>
                      <Button type="submit" size="sm" className="w-full">Save Account</Button>
                    </div>
                  </form>
                </div>
              )}
              {gstRecords.length === 0 ? (
                <div className="p-4 flex flex-col gap-4 text-sm text-center text-muted-foreground py-8">
                  <FileText className="size-8 mx-auto opacity-20" />
                  <p>No records added.</p>
                </div>
              ) : (
                <div className="divide-y text-xs">
                  {gstRecords.filter(r => !r.isArchived).map((rec) => (
                    <div key={rec.id} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="font-mono">{rec.id}</p>
                        <p className="font-semibold text-sm">{rec.accountNo}</p>
                      </div>
                      <div className="text-right text-muted-foreground">
                        <p>{rec.obtainedDate}</p>
                        <p>{rec.obtainedBy}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {needsUSTaxes && (
          <Card>
            <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-primary">US State Sales Tax IDs</CardTitle>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setShowAddSalesTax(!showAddSalesTax)}>
                {showAddSalesTax ? "Cancel" : <><Plus className="size-3 mr-1"/> Add</>}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {showAddSalesTax && (
                <div className="p-4 bg-muted/10 border-b text-sm">
                  <form onSubmit={(e) => handleSaveTaxRecord(e, "STX", setSalesTaxRecords, salesTaxRecords, setShowAddSalesTax)}>
                    <div className="space-y-3">
                      <div className="space-y-1"><Label>Account No</Label><Input name="accountNo" required /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label>Obtained Date</Label><Input name="obtainedDate" type="date" required /></div>
                        <div className="space-y-1"><Label>Obtained By</Label><Input name="obtainedBy" required /></div>
                      </div>
                      <Button type="submit" size="sm" className="w-full">Save Tax ID</Button>
                    </div>
                  </form>
                </div>
              )}
              {salesTaxRecords.length === 0 ? (
                <div className="p-4 flex flex-col gap-4 text-sm text-center text-muted-foreground py-8">
                  <FileText className="size-8 mx-auto opacity-20" />
                  <p>No records added.</p>
                </div>
              ) : (
                <div className="divide-y text-xs">
                  {salesTaxRecords.filter(r => !r.isArchived).map((rec) => (
                    <div key={rec.id} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="font-mono">{rec.id}</p>
                        <p className="font-semibold text-sm">{rec.accountNo}</p>
                      </div>
                      <div className="text-right text-muted-foreground">
                        <p>{rec.obtainedDate}</p>
                        <p>{rec.obtainedBy}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  )
}
