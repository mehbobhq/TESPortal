"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Building2, Plus, Archive, FileText, CheckCircle2, User, Phone, Mail, ScanLine, CreditCard } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// --- REUSABLE OCR UPLOAD ZONE ---
const DocumentUploadZone = ({ title, description }: { title: string, description: string }) => (
  <div className="w-full mt-4 border-2 border-dashed border-primary/20 rounded-xl p-6 flex flex-col items-center justify-center text-center bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer group">
    <div className="p-3 bg-background rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform">
      <ScanLine className="size-5 text-primary" />
    </div>
    <h3 className="font-semibold text-sm text-foreground mb-1">{title}</h3>
    <p className="text-xs text-muted-foreground max-w-sm mb-3">{description}</p>
    <Button variant="secondary" size="sm" className="pointer-events-none h-7 text-xs">
      Browse Files
    </Button>
  </div>
)

export default function ContactsPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  
  // UI State for inline form
  const [showAddContact, setShowAddContact] = useState(false)
  const [isPrimaryChecked, setIsPrimaryChecked] = useState(false)

  // Data State
  const [contacts, setContacts] = useState<any[]>([])

  useEffect(() => {
    const id = params.id as string
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const found = savedCompanies.find((c: any) => c.id === id)
    setCompany(found || null)
    
    // Simulated database fetch for Contacts
    setContacts([
      {
        id: `${id}-CNT-1001`,
        firstName: "Michael",
        lastName: "Scott",
        role: "Owner",
        email: "michael@example.com",
        phone: "+1 (555) 123-4567",
        isPrimary: true,
        dlNumber: "AB-123456-78",
        dlState: "AB",
        dlExpiry: "2029-05-12",
        isArchived: false
      }
    ])
    
    setLoading(false)
  }, [params.id])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <div className="p-10 text-center">Company Not Found</div>

  // --- SAVE HANDLER ---
  const generateId = () => `${company.id}-CNT-${Math.floor(1000 + Math.random() * 9000)}`

  const handleSaveContact = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    
    // If they checked "Primary", uncheck all other primary contacts
    const updatedContacts = isPrimaryChecked 
      ? contacts.map(c => ({ ...c, isPrimary: false })) 
      : [...contacts]

    const newContact = {
      id: generateId(),
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      role: formData.get("role"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      dlNumber: formData.get("dlNumber"),
      dlState: formData.get("dlState"),
      dlExpiry: formData.get("dlExpiry"),
      isPrimary: isPrimaryChecked,
      isArchived: false
    }
    
    setContacts([newContact, ...updatedContacts])
    setShowAddContact(false)
    setIsPrimaryChecked(false)
  }

  const primaryContact = contacts.find(c => c.isPrimary && !c.isArchived)

  return (
    <div className="flex flex-col gap-6 pb-10 max-w-6xl">
      
      {/* 1. HEADER & COMPLIANCE CONTEXT */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/companies/${company.id}/profile`)}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Corporate Personnel</h1>
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
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? <FileText className="size-4 mr-2" /> : <Archive className="size-4 mr-2" />}
              {showArchived ? "Hide Archived" : "View Archive"}
            </Button>
          </div>
        </div>
      </div>

      {/* 2. PRIMARY CONTACT SPOTLIGHT */}
      {primaryContact && (
        <Card className="border-primary/40 bg-primary/5 shadow-sm">
          <CardHeader className="py-3 border-b border-primary/10">
            <CardTitle className="text-sm flex items-center gap-2 text-primary">
              <User className="size-4" /> Primary Corporate Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Name & Role</p>
              <p className="text-sm font-semibold">{primaryContact.firstName} {primaryContact.lastName}</p>
              <p className="text-xs text-muted-foreground">{primaryContact.role}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Contact Info</p>
              <p className="text-sm flex items-center gap-1.5"><Phone className="size-3.5 text-muted-foreground"/> {primaryContact.phone}</p>
              <p className="text-xs flex items-center gap-1.5 mt-1"><Mail className="size-3.5 text-muted-foreground"/> {primaryContact.email}</p>
            </div>
            <div className="space-y-1 lg:col-span-2">
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Identity Verification</p>
              {primaryContact.dlNumber ? (
                <div className="flex items-center gap-4 mt-1 bg-background border p-2 rounded-md">
                  <CreditCard className="size-6 text-muted-foreground/50" />
                  <div>
                    <p className="text-xs font-mono font-medium">{primaryContact.dlNumber} ({primaryContact.dlState})</p>
                    <p className="text-[10px] text-muted-foreground">Expires: {primaryContact.dlExpiry}</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs italic text-muted-foreground mt-1">No ID on file.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. CORPORATE PERSONNEL LEDGER */}
      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">Personnel Directory</CardTitle>
            <CardDescription className="text-xs mt-1">Officers, managers, and administrative contacts.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowAddContact(!showAddContact)} variant={showAddContact ? "outline" : "default"}>
            {showAddContact ? "Cancel" : <><Plus className="size-4 mr-1"/> Add Contact</>}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          
          {/* INLINE ADD CONTACT FORM */}
          {showAddContact && (
            <form onSubmit={handleSaveContact} className="p-6 bg-muted/10 border-b border-primary/20">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-sm">Add New Personnel</h4>
                <div className="flex items-center space-x-2 bg-background border px-3 py-1.5 rounded-md">
                  <Checkbox 
                    id="isPrimary" 
                    checked={isPrimaryChecked} 
                    onCheckedChange={(c) => setIsPrimaryChecked(c === true)} 
                  />
                  <Label htmlFor="isPrimary" className="text-xs font-medium cursor-pointer">Set as Primary Contact</Label>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                
                {/* Basic Info */}
                <div className="space-y-4 lg:col-span-2 grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2 mt-4"><Label>First Name *</Label><Input name="firstName" required /></div>
                  <div className="space-y-2 mt-4"><Label>Last Name *</Label><Input name="lastName" required /></div>
                  <div className="space-y-2">
                    <Label>Role / Title *</Label>
                    <Select name="role" required>
                      <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Owner">Owner / President</SelectItem>
                        <SelectItem value="Safety Manager">Safety Manager</SelectItem>
                        <SelectItem value="Dispatcher">Dispatcher</SelectItem>
                        <SelectItem value="Billing">Billing / Accounting</SelectItem>
                        <SelectItem value="Compliance Officer">Compliance Officer</SelectItem>
                        <SelectItem value="Consultant">Third-Party Consultant</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Phone Number *</Label><Input name="phone" required /></div>
                  <div className="space-y-2 sm:col-span-2"><Label>Email Address *</Label><Input name="email" type="email" required /></div>
                </div>

                {/* Identity / DL Info */}
                <div className="space-y-4 bg-background p-4 rounded-xl border">
                  <div className="flex items-center gap-2 mb-2">
                    <CreditCard className="size-4 text-primary" />
                    <Label className="text-primary font-semibold">Identity (Driver's License)</Label>
                  </div>
                  <div className="space-y-2"><Label className="text-xs">License Number</Label><Input name="dlNumber" placeholder="e.g. 123456789" /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2"><Label className="text-xs">Issuing State/Prov</Label><Input name="dlState" placeholder="e.g. AB, TX" maxLength={2} /></div>
                    <div className="space-y-2"><Label className="text-xs">Expiry Date</Label><Input name="dlExpiry" type="date" /></div>
                  </div>
                </div>
              </div>

              <DocumentUploadZone 
                title="Upload ID / License"
                description="Drop a scan of the contact's driver's license or government ID here for OCR verification."
              />

              <div className="flex justify-end gap-2 mt-6">
                <Button type="button" variant="outline" onClick={() => setShowAddContact(false)}>Cancel</Button>
                <Button type="submit">Save Contact</Button>
              </div>
            </form>
          )}

          {/* CONTACTS TABLE */}
          <div className="divide-y text-sm">
            <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
              <div className="col-span-3">Personnel</div>
              <div className="col-span-4">Contact Info</div>
              <div className="col-span-3">Identity / License</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {contacts.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">
                No corporate personnel records found.
              </div>
            ) : (
              contacts.filter(c => showArchived || !c.isArchived).map((contact) => (
                <div key={contact.id} className={`grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-center ${contact.isArchived ? 'opacity-50 bg-muted/5' : ''}`}>
                  
                  {/* Name & Role */}
                  <div className="col-span-3 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{contact.firstName} {contact.lastName}</span>
                      {contact.isPrimary && <Badge className="text-[9px] h-4 px-1.5 uppercase">Primary</Badge>}
                      {contact.isArchived && <Badge variant="secondary" className="text-[9px] h-4 px-1.5 uppercase">Archived</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">{contact.role}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/60">{contact.id}</span>
                  </div>

                  {/* Contact Methods */}
                  <div className="col-span-4 flex flex-col gap-1 text-sm">
                    <div className="flex items-center gap-2"><Phone className="size-3.5 text-muted-foreground"/> {contact.phone}</div>
                    <div className="flex items-center gap-2"><Mail className="size-3.5 text-muted-foreground"/> {contact.email}</div>
                  </div>

                  {/* ID / DL */}
                  <div className="col-span-3 flex flex-col gap-0.5">
                    {contact.dlNumber ? (
                      <>
                        <span className="font-mono text-xs font-medium">{contact.dlNumber} ({contact.dlState})</span>
                        <span className="text-[10px] text-muted-foreground">Exp: {contact.dlExpiry}</span>
                      </>
                    ) : (
                      <span className="text-xs italic text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="col-span-2 text-right flex justify-end gap-2 md:mt-0 mt-2">
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
