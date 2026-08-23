"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Building2, Plus, CheckCircle2, ShieldCheck, HardHat, FileKey2, ScanLine, Sparkles, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// --- REUSABLE OCR UPLOAD ZONE ---
const DocumentUploadZone = ({ title, description, isAutoFill }: { title: string, description: string, isAutoFill?: boolean }) => (
  <div className={`w-full border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center transition-colors cursor-pointer group ${isAutoFill ? 'border-blue-500/30 bg-blue-50/50 hover:bg-blue-50 dark:bg-blue-950/10 dark:hover:bg-blue-900/20' : 'border-primary/20 bg-primary/5 hover:bg-primary/10'}`}>
    <div className={`p-3 rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform ${isAutoFill ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400' : 'bg-background text-primary'}`}>
      {isAutoFill ? <Sparkles className="size-5" /> : <ScanLine className="size-5" />}
    </div>
    <h3 className="font-semibold text-sm text-foreground mb-1">{title}</h3>
    <p className="text-xs text-muted-foreground max-w-sm mb-3">{description}</p>
    <Button type="button" variant={isAutoFill ? "default" : "secondary"} size="sm" className={`pointer-events-none h-7 text-xs ${isAutoFill ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}>
      Browse Files
    </Button>
  </div>
)

export default function InsurancePage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  // UI States for Forms
  const [showAddTrans, setShowAddTrans] = useState(false)
  const [showAddWorkers, setShowAddWorkers] = useState(false)
  const [showAddBond, setShowAddBond] = useState(false)

  // Data States
  const [transPolicies, setTransPolicies] = useState<any[]>([])
  const [workersPolicies, setWorkersPolicies] = useState<any[]>([])
  const [suretyBonds, setSuretyBonds] = useState<any[]>([])

  useEffect(() => {
    const id = params.id as string
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const found = savedCompanies.find((c: any) => c.id === id)
    setCompany(found || null)
    setLoading(false)
  }, [params.id])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <div className="p-10 text-center">Company Not Found</div>

  const generateId = (prefix: string) => `${company.id}-${prefix}-${Math.floor(1000 + Math.random() * 9000)}`

  // --- SAVE HANDLERS ---
  const handleSaveTrans = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setTransPolicies([{
      id: generateId("INS"),
      type: formData.get("type"),
      number: formData.get("number"),
      company: formData.get("company"),
      broker: formData.get("broker"),
      limits: formData.get("limits"),
      effective: formData.get("effective"),
      expiry: formData.get("expiry"),
      status: "Active"
    }, ...transPolicies])
    setShowAddTrans(false)
  }

  const handleSaveWorkers = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setWorkersPolicies([{
      id: generateId("WCB"),
      type: formData.get("type"),
      number: formData.get("number"),
      company: formData.get("company"),
      effective: formData.get("effective"),
      expiry: formData.get("expiry"),
      status: "Active"
    }, ...workersPolicies])
    setShowAddWorkers(false)
  }

  const handleSaveBond = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setSuretyBonds([{
      id: generateId("BND"),
      type: formData.get("type"),
      number: formData.get("number"),
      company: formData.get("company"),
      principal: formData.get("principal"),
      amount: formData.get("amount"),
      effective: formData.get("effective"),
      expiry: formData.get("expiry"),
      status: "Active"
    }, ...suretyBonds])
    setShowAddBond(false)
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
            <h1 className="text-2xl font-bold tracking-tight">Insurance & Bonds</h1>
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

      {/* 2. TRANSPORTATION INSURANCE */}
      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" /> Transportation Insurance
            </CardTitle>
            <CardDescription className="text-xs mt-1">Auto liability, general liability, and cargo coverage.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => setShowAddTrans(true)}>
              <ScanLine className="size-4 mr-1"/> Scan Policy
            </Button>
            <Button size="sm" onClick={() => setShowAddTrans(true)}>
              <Plus className="size-4 mr-1"/> Manual Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          
          {showAddTrans && (
            <form onSubmit={handleSaveTrans} className="p-6 bg-primary/5 border-b border-primary/20">
              <h4 className="font-semibold text-sm text-primary mb-4">Add Insurance Policy</h4>
              
              <div className="mb-6">
                <DocumentUploadZone 
                  isAutoFill={true}
                  title="Upload Policy Certificate for Auto-Fill"
                  description="Drop a Certificate of Insurance (COI) here. AI will extract coverage types, limits, and dates."
                />
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Coverage Type *</Label>
                  <Select name="type" required>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Auto Liability">Auto Liability</SelectItem>
                      <SelectItem value="General Liability">General Liability</SelectItem>
                      <SelectItem value="Motor Truck Cargo">Motor Truck Cargo</SelectItem>
                      <SelectItem value="Physical Damage">Physical Damage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Policy Number *</Label><Input name="number" required /></div>
                <div className="space-y-2"><Label>Coverage Limits</Label><Input name="limits" placeholder="e.g. $1,000,000" /></div>
                
                <div className="space-y-2 sm:col-span-2"><Label>Insurance Carrier *</Label><Input name="company" required /></div>
                <div className="space-y-2"><Label>Broker Name</Label><Input name="broker" /></div>

                <div className="space-y-2"><Label>Effective Date *</Label><Input name="effective" type="date" required /></div>
                <div className="space-y-2"><Label>Expiry Date *</Label><Input name="expiry" type="date" required /></div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <Button type="button" variant="outline" onClick={() => setShowAddTrans(false)}>Cancel</Button>
                <Button type="submit">Save Policy</Button>
              </div>
            </form>
          )}

          <div className="divide-y text-sm">
            <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
              <div className="col-span-3">Coverage</div>
              <div className="col-span-3">Carrier / Broker</div>
              <div className="col-span-2">Limits</div>
              <div className="col-span-2">Dates</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {transPolicies.length === 0 ? (
               <div className="p-10 text-center flex flex-col items-center justify-center">
                 <ShieldCheck className="size-10 text-muted-foreground/30 mb-3" />
                 <p className="text-sm font-medium text-muted-foreground">No transportation policies found.</p>
                 <p className="text-xs text-muted-foreground mt-1 max-w-[250px]">Click "Scan Policy" to extract data from a COI.</p>
               </div>
            ) : (
              transPolicies.map((p) => (
                <div key={p.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-center hover:bg-muted/30 transition-colors group">
                  <div className="col-span-3 flex flex-col gap-1">
                    <span className="font-semibold">{p.type}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{p.number}</span>
                  </div>
                  <div className="col-span-3 flex flex-col gap-1 text-sm">
                    <span>{p.company}</span>
                    <span className="text-xs text-muted-foreground">Broker: {p.broker || "—"}</span>
                  </div>
                  <div className="col-span-2 font-mono text-xs">{p.limits || "—"}</div>
                  <div className="col-span-2 flex flex-col gap-0.5 text-xs">
                    <span className="text-muted-foreground">Eff: {p.effective}</span>
                    <span className="font-medium text-destructive">Exp: {p.expiry}</span>
                  </div>
                  <div className="col-span-2 text-right flex justify-end gap-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* 3. WORKERS INSURANCE */}
      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <HardHat className="size-4 text-primary" /> Workers Insurance
            </CardTitle>
            <CardDescription className="text-xs mt-1">WSIB, WCB, and occupational accident coverage.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => setShowAddWorkers(true)}>
              <ScanLine className="size-4 mr-1"/> Scan Clearance
            </Button>
            <Button size="sm" onClick={() => setShowAddWorkers(true)}>
              <Plus className="size-4 mr-1"/> Manual Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          
          {showAddWorkers && (
            <form onSubmit={handleSaveWorkers} className="p-6 bg-primary/5 border-b border-primary/20">
              <h4 className="font-semibold text-sm text-primary mb-4">Add Workers Compensation</h4>
              
              <div className="mb-6">
                <DocumentUploadZone 
                  isAutoFill={true}
                  title="Upload Clearance Certificate"
                  description="Drop a WSIB/WCB clearance letter here for AI data extraction."
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Account Type *</Label>
                  <Select name="type" required>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WSIB">WSIB (Ontario)</SelectItem>
                      <SelectItem value="WCB">WCB (Other Provinces)</SelectItem>
                      <SelectItem value="WCC">Workers Comp (US)</SelectItem>
                      <SelectItem value="OccAcc">Occupational Accident</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Account / Policy Number *</Label><Input name="number" required /></div>
                <div className="space-y-2 sm:col-span-2"><Label>Issuing Board / Carrier *</Label><Input name="company" required /></div>
                <div className="space-y-2"><Label>Effective Date</Label><Input name="effective" type="date" /></div>
                <div className="space-y-2"><Label>Expiry Date</Label><Input name="expiry" type="date" /></div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <Button type="button" variant="outline" onClick={() => setShowAddWorkers(false)}>Cancel</Button>
                <Button type="submit">Save Record</Button>
              </div>
            </form>
          )}

          <div className="divide-y text-sm">
            <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
              <div className="col-span-4">Coverage</div>
              <div className="col-span-4">Issuing Board / Carrier</div>
              <div className="col-span-2">Dates</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {workersPolicies.length === 0 ? (
               <div className="p-10 text-center flex flex-col items-center justify-center">
                 <HardHat className="size-10 text-muted-foreground/30 mb-3" />
                 <p className="text-sm font-medium text-muted-foreground">No workers insurance records found.</p>
               </div>
            ) : (
              workersPolicies.map((p) => (
                <div key={p.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-center hover:bg-muted/30 transition-colors group">
                  <div className="col-span-4 flex flex-col gap-1">
                    <span className="font-semibold">{p.type}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{p.number}</span>
                  </div>
                  <div className="col-span-4 text-sm">{p.company}</div>
                  <div className="col-span-2 flex flex-col gap-0.5 text-xs">
                    <span className="text-muted-foreground">Eff: {p.effective || "—"}</span>
                    <span className="font-medium">Exp: {p.expiry || "—"}</span>
                  </div>
                  <div className="col-span-2 text-right flex justify-end gap-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* 4. SURETY BONDS */}
      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileKey2 className="size-4 text-primary" /> Surety Bonds
            </CardTitle>
            <CardDescription className="text-xs mt-1">Customs bonds, freight broker bonds, and performance guarantees.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => setShowAddBond(true)}>
              <ScanLine className="size-4 mr-1"/> Scan Bond
            </Button>
            <Button size="sm" onClick={() => setShowAddBond(true)}>
              <Plus className="size-4 mr-1"/> Manual Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          
          {showAddBond && (
            <form onSubmit={handleSaveBond} className="p-6 bg-primary/5 border-b border-primary/20">
              <h4 className="font-semibold text-sm text-primary mb-4">Add Surety Bond</h4>
              
              <div className="mb-6">
                <DocumentUploadZone 
                  isAutoFill={true}
                  title="Upload Bond Document"
                  description="Drop a Continuous Bond or Single Entry Bond document here for OCR extraction."
                />
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Bond Type *</Label>
                  <Select name="type" required>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="US Customs (Continuous)">US Customs (Continuous)</SelectItem>
                      <SelectItem value="Freight Broker (BMC-84)">Freight Broker (BMC-84)</SelectItem>
                      <SelectItem value="Performance Bond">Performance Bond</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Bond Number *</Label><Input name="number" required /></div>
                <div className="space-y-2"><Label>Bond Amount</Label><Input name="amount" placeholder="e.g. $50,000" /></div>
                
                <div className="space-y-2 sm:col-span-2"><Label>Surety Company *</Label><Input name="company" required /></div>
                <div className="space-y-2"><Label>Principal Name</Label><Input name="principal" defaultValue={company.name} /></div>

                <div className="space-y-2"><Label>Effective Date *</Label><Input name="effective" type="date" required /></div>
                <div className="space-y-2"><Label>Expiry Date (If applicable)</Label><Input name="expiry" type="date" /></div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <Button type="button" variant="outline" onClick={() => setShowAddBond(false)}>Cancel</Button>
                <Button type="submit">Save Bond</Button>
              </div>
            </form>
          )}

          <div className="divide-y text-sm">
            <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
              <div className="col-span-3">Bond Info</div>
              <div className="col-span-3">Surety</div>
              <div className="col-span-2">Amount</div>
              <div className="col-span-2">Dates</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {suretyBonds.length === 0 ? (
               <div className="p-10 text-center flex flex-col items-center justify-center">
                 <FileKey2 className="size-10 text-muted-foreground/30 mb-3" />
                 <p className="text-sm font-medium text-muted-foreground">No surety bonds found.</p>
               </div>
            ) : (
              suretyBonds.map((b) => (
                <div key={b.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-center hover:bg-muted/30 transition-colors group">
                  <div className="col-span-3 flex flex-col gap-1">
                    <span className="font-semibold">{b.type}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{b.number}</span>
                  </div>
                  <div className="col-span-3 text-sm">{b.company}</div>
                  <div className="col-span-2 font-mono text-xs font-medium">{b.amount || "—"}</div>
                  <div className="col-span-2 flex flex-col gap-0.5 text-xs">
                    <span className="text-muted-foreground">Eff: {b.effective}</span>
                    <span className="font-medium text-destructive">Exp: {b.expiry || "Continuous"}</span>
                  </div>
                  <div className="col-span-2 text-right flex justify-end gap-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
