"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Building2, Plus, CheckCircle2, ScanLine, Sparkles, FileBadge, ShieldAlert, FileKey, CheckSquare } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// --- REUSABLE OCR UPLOAD ZONE ---
const DocumentUploadZone = ({ title, description, isAutoFill }: { title: string, description: string, isAutoFill?: boolean }) => (
  <div className={`w-full border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center transition-colors cursor-pointer group ${isAutoFill ? 'border-blue-500/30 bg-blue-50/50 hover:bg-blue-50 dark:bg-blue-950/10 dark:hover:bg-blue-900/20' : 'border-primary/20 bg-primary/5 hover:bg-primary/10'}`}>
    <div className={`p-2 rounded-full shadow-sm mb-2 group-hover:scale-110 transition-transform ${isAutoFill ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400' : 'bg-background text-primary'}`}>
      {isAutoFill ? <Sparkles className="size-4" /> : <ScanLine className="size-4" />}
    </div>
    <h3 className="font-semibold text-xs text-foreground mb-1">{title}</h3>
    <p className="text-[10px] text-muted-foreground max-w-sm mb-3 leading-tight">{description}</p>
    <Button type="button" variant={isAutoFill ? "default" : "secondary"} size="sm" className={`pointer-events-none h-6 text-[10px] px-2 ${isAutoFill ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}>
      Browse Files
    </Button>
  </div>
)

export default function AuthoritiesPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  // UI States for Forms
  const [showAddCanadian, setShowAddCanadian] = useState(false)
  const [showAddUS, setShowAddUS] = useState(false)
  const [showAddUCR, setShowAddUCR] = useState(false)
  const [showAddHazmat, setShowAddHazmat] = useState(false)

  // Data States
  const [canadianRecords, setCanadianRecords] = useState<any[]>([])
  const [usRecords, setUsRecords] = useState<any[]>([])
  const [ucrRecords, setUcrRecords] = useState<any[]>([])
  const [hazmatRecords, setHazmatRecords] = useState<any[]>([])

  useEffect(() => {
    const id = params.id as string
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const found = savedCompanies.find((c: any) => c.id === id)
    setCompany(found || null)
    setLoading(false)
  }, [params.id])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <div className="p-10 text-center">Company Not Found</div>

  // --- CORE COMPLIANCE LOGIC EVALUATION ---
  const isCanadaRegistered = company.regCorpCountry === "Canada"
  const isUSRegistered = company.regCorpCountry === "United States"
  const isCrossBorder = company.region === "Cross-Border"
  const isCanadaOnly = company.region === "Canada Only"

  // Exact rendering logic based on regional AND operational inputs
  const needsCanadianAuthorities = isCanadaRegistered || isCrossBorder
  const needsUSAuthorities = isUSRegistered || isCrossBorder
  const needsUCR = isUSRegistered || isCrossBorder
  
  // HAZMAT TRIGGER LOGIC:
  // 1. Reads directly from the cargoTypes array established in New/Edit Company
  // 2. Must NOT be Canada Only (PHMSA is a US DOT requirement)
  const haulsHazmat = company.cargoTypes?.includes("Hazardous Materials") || false
  const needsHazmat = haulsHazmat && !isCanadaOnly

  const generateId = (prefix: string) => `${company.id}-${prefix}-${Math.floor(1000 + Math.random() * 9000)}`

  // --- SAVE HANDLERS ---
  const handleSaveCanadian = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setCanadianRecords([{
      id: generateId("CAN"),
      mvid: formData.get("mvid"),
      cvor: formData.get("cvor"),
      obtainedDate: formData.get("obtainedDate"),
    }, ...canadianRecords])
    setShowAddCanadian(false)
  }

  const handleSaveUS = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setUsRecords([{
      id: generateId("USA"),
      usdot: formData.get("usdot"),
      mc: formData.get("mc"),
      pin: formData.get("pin"),
      obtainedDate: formData.get("obtainedDate"),
    }, ...usRecords])
    setShowAddUS(false)
  }

  const handleSaveUCR = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setUcrRecords([{
      id: generateId("UCR"),
      obtainedDate: formData.get("obtainedDate"),
      expiryDate: formData.get("expiryDate"),
    }, ...ucrRecords])
    setShowAddUCR(false)
  }

  const handleSaveHazmat = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setHazmatRecords([{
      id: generateId("PHM"),
      registrationNo: formData.get("registrationNo"),
      effectiveDate: formData.get("effectiveDate"),
      expiryDate: formData.get("expiryDate"),
    }, ...hazmatRecords])
    setShowAddHazmat(false)
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
            <h1 className="text-2xl font-bold tracking-tight">Operating Authorities</h1>
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

      {/* 2. CANADIAN AUTHORITIES */}
      {needsCanadianAuthorities && (
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <FileBadge className="size-4 text-primary" /> Canadian Operations
              </CardTitle>
              <CardDescription className="text-xs mt-1">Provincial Carrier ID and NSC/CVOR Records.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => setShowAddCanadian(true)}>
                <ScanLine className="size-4 mr-1"/> Scan Safety Cert
              </Button>
              <Button size="sm" onClick={() => setShowAddCanadian(true)}>
                <Plus className="size-4 mr-1"/> Manual Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            
            {showAddCanadian && (
              <form onSubmit={handleSaveCanadian} className="p-6 bg-primary/5 border-b border-primary/20">
                <h4 className="font-semibold text-sm text-primary mb-4">Add Canadian Authority</h4>
                
                <div className="mb-6">
                  <DocumentUploadZone 
                    isAutoFill={true}
                    title="Mandatory: Safety Fitness Certificate / CVOR"
                    description="Drop document here. OCR will extract NSC and Client numbers."
                  />
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-2"><Label>MVID / RIN (Provincial ID)</Label><Input name="mvid" required /></div>
                  <div className="space-y-2"><Label>CVOR / NSC Number</Label><Input name="cvor" required /></div>
                  <div className="space-y-2"><Label>Date Obtained</Label><Input name="obtainedDate" type="date" required /></div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowAddCanadian(false)}>Cancel</Button>
                  <Button type="submit">Save Authority</Button>
                </div>
              </form>
            )}

            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                <div className="col-span-3">Record ID</div>
                <div className="col-span-3">MVID / RIN</div>
                <div className="col-span-3">CVOR / NSC</div>
                <div className="col-span-2">Date Obtained</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {canadianRecords.length === 0 ? (
                 <div className="p-8 text-center text-muted-foreground text-sm">No Canadian authorities found.</div>
              ) : (
                canadianRecords.map((r) => (
                  <div key={r.id} className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-mono text-xs">{r.id}</div>
                    <div className="col-span-3 font-medium">{r.mvid}</div>
                    <div className="col-span-3 font-medium">{r.cvor}</div>
                    <div className="col-span-2 text-xs">{r.obtainedDate}</div>
                    <div className="col-span-1 text-right"><Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button></div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. US AUTHORITIES (FMCSA) */}
      {needsUSAuthorities && (
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <FileKey className="size-4 text-primary" /> US Federal Operations (FMCSA)
              </CardTitle>
              <CardDescription className="text-xs mt-1">USDOT Number, MC Authority, and Portal PIN.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => setShowAddUS(true)}>
                <ScanLine className="size-4 mr-1"/> Scan Letters
              </Button>
              <Button size="sm" onClick={() => setShowAddUS(true)}>
                <Plus className="size-4 mr-1"/> Manual Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            
            {showAddUS && (
              <form onSubmit={handleSaveUS} className="p-6 bg-primary/5 border-b border-primary/20">
                <h4 className="font-semibold text-sm text-primary mb-4">Add US Authority</h4>
                
                {/* Side-by-side Uploads for US requirements */}
                <div className="grid sm:grid-cols-2 gap-4 mb-6">
                  <DocumentUploadZone 
                    isAutoFill={true}
                    title="Mandatory: USDOT PIN Letter"
                    description="OCR will extract USDOT and Portal PIN."
                  />
                  <DocumentUploadZone 
                    isAutoFill={true}
                    title="Mandatory: MC Authority Letter"
                    description="OCR will extract the MC operating authority."
                  />
                </div>

                <div className="grid sm:grid-cols-4 gap-4">
                  <div className="space-y-2"><Label>USDOT Number</Label><Input name="usdot" required /></div>
                  <div className="space-y-2"><Label>MC Number</Label><Input name="mc" required /></div>
                  <div className="space-y-2"><Label>USDOT PIN</Label><Input name="pin" type="password" placeholder="••••••••" required /></div>
                  <div className="space-y-2"><Label>Date Obtained</Label><Input name="obtainedDate" type="date" required /></div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowAddUS(false)}>Cancel</Button>
                  <Button type="submit">Save US Authority</Button>
                </div>
              </form>
            )}

            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                <div className="col-span-3">Record ID</div>
                <div className="col-span-2">USDOT</div>
                <div className="col-span-2">MC Number</div>
                <div className="col-span-2">USDOT PIN</div>
                <div className="col-span-2">Date Obtained</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {usRecords.length === 0 ? (
                 <div className="p-8 text-center text-muted-foreground text-sm">No US authorities found.</div>
              ) : (
                usRecords.map((r) => (
                  <div key={r.id} className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-mono text-xs">{r.id}</div>
                    <div className="col-span-2 font-medium">{r.usdot}</div>
                    <div className="col-span-2 font-medium">{r.mc}</div>
                    <div className="col-span-2 text-muted-foreground">{r.pin ? "••••••••" : "—"}</div>
                    <div className="col-span-2 text-xs">{r.obtainedDate}</div>
                    <div className="col-span-1 text-right"><Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button></div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 5. UCR REGISTRATION */}
      {needsUCR && (
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckSquare className="size-4 text-primary" /> Unified Carrier Registration (UCR)
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => setShowAddUCR(true)}>
                <ScanLine className="size-4 mr-1"/> Scan Receipt
              </Button>
              <Button size="sm" onClick={() => setShowAddUCR(true)}>
                <Plus className="size-4 mr-1"/> Manual Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            
            {showAddUCR && (
              <form onSubmit={handleSaveUCR} className="p-6 bg-primary/5 border-b border-primary/20">
                <div className="mb-6">
                  <DocumentUploadZone 
                    isAutoFill={true}
                    title="Mandatory: UCR Certificate / Receipt"
                    description="Upload the official UCR receipt for the current filing year."
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Date Obtained</Label><Input name="obtainedDate" type="date" required /></div>
                  <div className="space-y-2"><Label>Expiry Date</Label><Input name="expiryDate" type="date" required /></div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowAddUCR(false)}>Cancel</Button>
                  <Button type="submit">Save UCR</Button>
                </div>
              </form>
            )}

            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                <div className="col-span-3">Record ID</div>
                <div className="col-span-4">Date Obtained</div>
                <div className="col-span-4">Expiry Date</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {ucrRecords.length === 0 ? (
                 <div className="p-8 text-center text-muted-foreground text-sm">No UCR records found.</div>
              ) : (
                ucrRecords.map((r) => (
                  <div key={r.id} className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-mono text-xs">{r.id}</div>
                    <div className="col-span-4">{r.obtainedDate}</div>
                    <div className="col-span-4 text-destructive font-medium">{r.expiryDate}</div>
                    <div className="col-span-1 text-right"><Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button></div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 6. HAZMAT AUTHORITIES (Triggered securely by Company Profile state) */}
      {needsHazmat && (
        <Card className="border-destructive/30 shadow-sm">
          <CardHeader className="bg-destructive/5 py-3 border-b border-destructive/20 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                <ShieldAlert className="size-4" /> PHMSA Hazmat Registration
              </CardTitle>
              <CardDescription className="text-xs mt-1">Required because "Hazardous Materials" is listed in this company's cargo profile for US operations.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => setShowAddHazmat(true)}>
                <ScanLine className="size-4 mr-1"/> Scan PHMSA License
              </Button>
              <Button size="sm" onClick={() => setShowAddHazmat(true)}>
                <Plus className="size-4 mr-1"/> Manual Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            
            {showAddHazmat && (
              <form onSubmit={handleSaveHazmat} className="p-6 bg-primary/5 border-b border-primary/20">
                <div className="mb-6">
                  <DocumentUploadZone 
                    isAutoFill={true}
                    title="Mandatory: PHMSA License"
                    description="Drop your PHMSA Registration Certificate here."
                  />
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-2"><Label>Registration Number</Label><Input name="registrationNo" required /></div>
                  <div className="space-y-2"><Label>Effective Date</Label><Input name="effectiveDate" type="date" required /></div>
                  <div className="space-y-2"><Label>Expiry Date</Label><Input name="expiryDate" type="date" required /></div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowAddHazmat(false)}>Cancel</Button>
                  <Button type="submit">Save PHMSA</Button>
                </div>
              </form>
            )}

            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                <div className="col-span-3">Record ID</div>
                <div className="col-span-3">Registration Number</div>
                <div className="col-span-3">Effective Date</div>
                <div className="col-span-2">Expiry Date</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {hazmatRecords.length === 0 ? (
                 <div className="p-8 text-center text-muted-foreground text-sm">No active Hazmat registrations.</div>
              ) : (
                hazmatRecords.map((r) => (
                  <div key={r.id} className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-mono text-xs">{r.id}</div>
                    <div className="col-span-3 font-medium">{r.registrationNo}</div>
                    <div className="col-span-3 text-xs">{r.effectiveDate}</div>
                    <div className="col-span-2 text-xs text-destructive font-medium">{r.expiryDate}</div>
                    <div className="col-span-1 text-right"><Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button></div>
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
