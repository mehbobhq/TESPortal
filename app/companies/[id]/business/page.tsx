"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Building2, Plus, FileText, UploadCloud, FileArchive, CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function BusinessPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  
  // UI State for inline forms
  const [showAddShareholder, setShowAddShareholder] = useState(false)
  const [showAddReturn, setShowAddReturn] = useState(false)
  const [showAddCra, setShowAddCra] = useState(false)
  const [showAddEin, setShowAddEin] = useState(false)
  const [showAddGst, setShowAddGst] = useState(false)
  const [showAddSalesTax, setShowAddSalesTax] = useState(false)

  // Data States
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
          <Button variant="outline" size="sm" className="h-7 text-xs">Edit Origin</Button>
        </CardHeader>
        <CardContent className="pt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="space-y-1"><p className="text-xs text-muted-foreground font-medium uppercase">Record ID</p><p className="text-sm font-mono font-medium">{company.id}</p></div>
          <div className="space-y-1"><p className="text-xs text-muted-foreground font-medium uppercase">{isCanadaRegistered ? "Corporate Number" : "State File Number"}</p><p className="text-sm font-medium">{company.incorpNo || "—"}</p></div>
          <div className="space-y-1"><p className="text-xs text-muted-foreground font-medium uppercase">Incorporation Date</p><p className="text-sm font-medium">—</p></div>
          <div className="space-y-1"><p className="text-xs text-muted-foreground font-medium uppercase">Jurisdiction</p><p className="text-sm font-medium">{company.regCorpState}, {company.regCorpCountry}</p></div>
          
          <div className="sm:col-span-2 lg:col-span-4 mt-2 pt-4 border-t flex items-center justify-between bg-muted/20 p-3 rounded-md border border-dashed">
            <div className="flex items-center gap-3">
              <FileText className="size-8 text-muted-foreground/50" />
              <div>
                <p className="text-sm font-medium">Corporate Documents</p>
                <p className="text-xs text-muted-foreground">
                  {isCanadaRegistered 
                    ? "Upload Articles of Incorporation, Certificate of Status, etc." 
                    : isUSRegistered 
                      ? "Upload State Charter, Articles of Incorporation, etc." 
                      : "Upload corporate formation documents."}
                </p>
              </div>
            </div>
            <Button size="sm" variant="secondary"><UploadCloud className="size-4 mr-2"/> Upload File</Button>
          </div>
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
            <form onSubmit={handleSaveReturn} className="p-6 bg-muted/10 border-b">
              <h4 className="font-semibold text-sm mb-4">Add Annual Return</h4>
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Due Date</Label><Input name="dueDate" type="date" required /></div>
                <div className="space-y-2"><Label>Filed Date</Label><Input name="filedDate" type="date" required /></div>
                <div className="space-y-2"><Label>Filed By</Label><Input name="filedBy" placeholder="Admin/Accountant" required /></div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button type="button" variant="outline" onClick={() => setShowAddReturn(false)}>Cancel</Button>
                <Button type="submit">Save Filing</Button>
              </div>
            </form>
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
                <form onSubmit={(e) => handleSaveTaxRecord(e, "CRA", setCraRecords, craRecords, setShowAddCra)} className="p-4 bg-muted/10 border-b text-sm">
                  <div className="space-y-3">
                    <div className="space-y-1"><Label>CRA Business No</Label><Input name="accountNo" required /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><Label>Obtained Date</Label><Input name="obtainedDate" type="date" required /></div>
                      <div className="space-y-1"><Label>Obtained By</Label><Input name="obtainedBy" required /></div>
                    </div>
                    <Button type="submit" size="sm" className="w-full">Save CRA Number</Button>
                  </div>
                </form>
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
                <form onSubmit={(e) => handleSaveTaxRecord(e, "EIN", setEinRecords, einRecords, setShowAddEin)} className="p-4 bg-muted/10 border-b text-sm">
                  <div className="space-y-3">
                    <div className="space-y-1"><Label>EIN Number</Label><Input name="accountNo" required /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><Label>Obtained Date</Label><Input name="obtainedDate" type="date" required /></div>
                      <div className="space-y-1"><Label>Obtained By</Label><Input name="obtainedBy" required /></div>
                    </div>
                    <div className="pt-2"><Button type="button" variant="secondary" size="sm" className="w-full"><UploadCloud className="size-4 mr-2"/>Upload IRS Letter</Button></div>
                    <Button type="submit" size="sm" className="w-full">Save EIN</Button>
                  </div>
                </form>
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
                <form onSubmit={(e) => handleSaveTaxRecord(e, "GST", setGstRecords, gstRecords, setShowAddGst)} className="p-4 bg-muted/10 border-b text-sm">
                  <div className="space-y-3">
                    <div className="space-y-1"><Label>Account No</Label><Input name="accountNo" required /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><Label>Obtained Date</Label><Input name="obtainedDate" type="date" required /></div>
                      <div className="space-y-1"><Label>Obtained By</Label><Input name="obtainedBy" required /></div>
                    </div>
                    <Button type="submit" size="sm" className="w-full">Save Account</Button>
                  </div>
                </form>
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
                <form onSubmit={(e) => handleSaveTaxRecord(e, "STX", setSalesTaxRecords, salesTaxRecords, setShowAddSalesTax)} className="p-4 bg-muted/10 border-b text-sm">
                  <div className="space-y-3">
                    <div className="space-y-1"><Label>Account No</Label><Input name="accountNo" required /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><Label>Obtained Date</Label><Input name="obtainedDate" type="date" required /></div>
                      <div className="space-y-1"><Label>Obtained By</Label><Input name="obtainedBy" required /></div>
                    </div>
                    <Button type="submit" size="sm" className="w-full">Save Tax ID</Button>
                  </div>
                </form>
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
