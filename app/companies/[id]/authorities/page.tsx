"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Building2, Plus, CheckCircle2, ScanLine, Sparkles, FileBadge, ShieldAlert, FileKey, Trash2 } from "lucide-react"

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

export default function AuthoritiesPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  // UI States for Forms
  const [showAddCanadian, setShowAddCanadian] = useState(false)
  const [showAddUS, setShowAddUS] = useState(false)
  const [showAddHazmat, setShowAddHazmat] = useState(false)

  // Data States
  const [canadianRecords, setCanadianRecords] = useState<any[]>([])
  const [usRecords, setUsRecords] = useState<any[]>([])
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

  // --- COMPLIANCE LOGIC EVALUATION ---
  const isCanadaRegistered = company.regCorpCountry === "Canada"
  const isUSRegistered = company.regCorpCountry === "United States"
  const isCrossBorder = company.region === "Cross-Border"

  // Determine what panels to show based on origin and region
  const needsCanadianAuthorities = isCanadaRegistered || isCrossBorder
  const needsUSAuthorities = isUSRegistered || isCrossBorder
  const needsHazmat = isUSRegistered || isCrossBorder // Always an option if touching the US

  const generateId = (prefix: string) => `${company.id}-${prefix}-${Math.floor(1000 + Math.random() * 9000)}`

  // --- SAVE HANDLERS ---
  const handleSaveCanadian = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setCanadianRecords([{
      id: generateId("CAN"),
      type: formData.get("type"),
      number: formData.get("number"),
      province: formData.get("province"),
      status: "Active"
    }, ...canadianRecords])
    setShowAddCanadian(false)
  }

  const handleSaveUS = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setUsRecords([{
      id: generateId("USA"),
      type: formData.get("type"),
      number: formData.get("number"),
      pin: formData.get("pin"),
      status: "Active"
    }, ...usRecords])
    setShowAddUS(false)
  }

  const handleSaveHazmat = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setHazmatRecords([{
      id: generateId("HAZ"),
      type: formData.get("type"),
      number: formData.get("number"),
      effective: formData.get("effective"),
      expiry: formData.get("expiry"),
      status: "Active"
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

      {/* 2. CANADIAN AUTHORITIES (Only rendered if applicable) */}
      {needsCanadianAuthorities && (
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <FileBadge className="size-4 text-primary" /> Canadian Operating Authorities
              </CardTitle>
              <CardDescription className="text-xs mt-1">Provincial Carrier IDs, NSC, and CVOR details.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => setShowAddCanadian(true)}>
                <ScanLine className="size-4 mr-1"/> Scan Document
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
                    title="Upload Certificate for Auto-Fill"
                    description="Drop a CVOR, Safety Fitness Certificate, or Provincial ID here for data extraction."
                  />
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-2 sm:col-span-1">
                    <Label>Authority Type *</Label>
                    <Select name="type" required>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        {isCanadaRegistered && <SelectItem value="Provincial Carrier ID">Provincial Carrier ID (MVID / MPI)</SelectItem>}
                        <SelectItem value="NSC Number">NSC Number (National Safety Code)</SelectItem>
                        <SelectItem value="CVOR">CVOR (Ontario)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-1"><Label>Record Number *</Label><Input name="number" required /></div>
                  <div className="space-y-2 sm:col-span-1">
                    <Label>Issuing Province *</Label>
                    <Input name="province" placeholder="e.g. AB, ON, BC" maxLength={2} required />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowAddCanadian(false)}>Cancel</Button>
                  <Button type="submit">Save Authority</Button>
                </div>
              </form>
            )}

            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                <div className="col-span-4">Authority Type</div>
                <div className="col-span-4">Record Number</div>
                <div className="col-span-2">Province</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>

              {canadianRecords.length === 0 ? (
                 <div className="p-10 text-center flex flex-col items-center justify-center">
                   <FileBadge className="size-10 text-muted-foreground/30 mb-3" />
                   <p className="text-sm font-medium text-muted-foreground">No Canadian authorities found.</p>
                 </div>
              ) : (
                canadianRecords.map((r) => (
                  <div key={r.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-center hover:bg-muted/30 transition-colors group">
                    <div className="col-span-4 font-semibold">{r.type}</div>
                    <div className="col-span-4 font-mono text-xs">{r.number}</div>
                    <div className="col-span-2"><Badge variant="outline">{r.province}</Badge></div>
                    <div className="col-span-2 text-right flex justify-end gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. US / FMCSA AUTHORITIES (Only rendered if applicable) */}
      {needsUSAuthorities && (
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <FileKey className="size-4 text-primary" /> Federal Motor Carrier (US)
              </CardTitle>
              <CardDescription className="text-xs mt-1">USDOT and MC Operating Authorities.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => setShowAddUS(true)}>
                <ScanLine className="size-4 mr-1"/> Scan PIN/Letter
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
                
                <div className="mb-6">
                  <DocumentUploadZone 
                    isAutoFill={true}
                    title="Upload FMCSA Letter"
                    description="Drop your DOT or MC grant letter here for instant AI data capture."
                  />
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-2 sm:col-span-1">
                    <Label>Authority Type *</Label>
                    <Select name="type" required>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USDOT Number">USDOT Number</SelectItem>
                        <SelectItem value="MC Number">MC Number</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-1"><Label>Registration Number *</Label><Input name="number" required /></div>
                  <div className="space-y-2 sm:col-span-1">
                    <Label>Portal PIN (Optional)</Label>
                    <Input name="pin" type="password" placeholder="••••••••" />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowAddUS(false)}>Cancel</Button>
                  <Button type="submit">Save Authority</Button>
                </div>
              </form>
            )}

            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                <div className="col-span-4">Authority Type</div>
                <div className="col-span-4">Record Number</div>
                <div className="col-span-2">Portal PIN</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>

              {usRecords.length === 0 ? (
                 <div className="p-10 text-center flex flex-col items-center justify-center">
                   <FileKey className="size-10 text-muted-foreground/30 mb-3" />
                   <p className="text-sm font-medium text-muted-foreground">No US authorities found.</p>
                 </div>
              ) : (
                usRecords.map((r) => (
                  <div key={r.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-center hover:bg-muted/30 transition-colors group">
                    <div className="col-span-4 font-semibold">{r.type}</div>
                    <div className="col-span-4 font-mono text-xs">{r.number}</div>
                    <div className="col-span-2 text-muted-foreground">{r.pin ? "••••••••" : "Not Provided"}</div>
                    <div className="col-span-2 text-right flex justify-end gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs">Edit</Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4. HAZMAT AUTHORITIES (Only rendered if applicable) */}
      {needsHazmat && (
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldAlert className="size-4 text-primary" /> Hazmat Authorities
              </CardTitle>
              <CardDescription className="text-xs mt-1">Hazardous Materials Safety Permit (HMSP) and PHMSA Registration.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => setShowAddHazmat(true)}>
                <ScanLine className="size-4 mr-1"/> Scan Permit
              </Button>
              <Button size="sm" onClick={() => setShowAddHazmat(true)}>
                <Plus className="size-4 mr-1"/> Manual Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            
            {showAddHazmat && (
              <form onSubmit={handleSaveHazmat} className="p-6 bg-primary/5 border-b border-primary/20">
                <h4 className="font-semibold text-sm text-primary mb-4">Add Hazmat Registration</h4>
                
                <div className="mb-6">
                  <DocumentUploadZone 
                    isAutoFill={true}
                    title="Upload Hazmat Certificate"
                    description="Drop your PHMSA or HMSP document here for automated entry."
                  />
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-2 lg:col-span-1">
                    <Label>Permit Type *</Label>
                    <Select name="type" required>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PHMSA Registration">PHMSA Registration</SelectItem>
                        <SelectItem value="HMSP Number">HMSP Number</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 lg:col-span-1"><Label>Registration Number *</Label><Input name="number" required /></div>
                  <div className="space-y-2 lg:col-span-1"><Label>Effective Date *</Label><Input name="effective" type="date" required /></div>
                  <div className="space-y-2 lg:col-span-1"><Label>Expiry Date *</Label><Input name="expiry" type="date" required /></div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowAddHazmat(false)}>Cancel</Button>
                  <Button type="submit">Save Permit</Button>
                </div>
              </form>
            )}

            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                <div className="col-span-4">Permit Type</div>
                <div className="col-span-3">Record Number</div>
                <div className="col-span-3">Validity Window</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>

              {hazmatRecords.length === 0 ? (
                 <div className="p-10 text-center flex flex-col items-center justify-center">
                   <ShieldAlert className="size-10 text-muted-foreground/30 mb-3" />
                   <p className="text-sm font-medium text-muted-foreground">No hazmat permits found.</p>
                 </div>
              ) : (
                hazmatRecords.map((r) => (
                  <div key={r.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-center hover:bg-muted/30 transition-colors group">
                    <div className="col-span-4 font-semibold">{r.type}</div>
                    <div className="col-span-3 font-mono text-xs">{r.number}</div>
                    <div className="col-span-3 flex flex-col gap-0.5 text-xs">
                      <span className="text-muted-foreground">Eff: {r.effective}</span>
                      <span className="font-medium text-destructive">Exp: {r.expiry}</span>
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
      )}

    </div>
  )
}
