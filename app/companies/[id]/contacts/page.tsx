"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Building2, Plus, FileText, CheckCircle2, User, Phone, Mail, ScanLine, CreditCard, Image as ImageIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

// --- REUSABLE OCR UPLOAD ZONE ---
const DocumentUploadZone = ({ title, description }: { title: string, description: string }) => (
  <div className="w-full mt-4 border-2 border-dashed border-primary/20 rounded-xl p-6 flex flex-col items-center justify-center text-center bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer group">
    <div className="p-3 bg-background rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform">
      <ScanLine className="size-5 text-primary" />
    </div>
    <h3 className="font-semibold text-sm text-foreground mb-1">{title}</h3>
    <p className="text-xs text-muted-foreground max-w-sm mb-3">{description}</p>
    <Button type="button" variant="secondary" size="sm" className="pointer-events-none h-7 text-xs">
      Browse Files
    </Button>
  </div>
)

export default function ContactsPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  
  // UI States
  const [showAddContact, setShowAddContact] = useState(false)
  const [isPrimaryChecked, setIsPrimaryChecked] = useState(false)
  const [selectedContact, setSelectedContact] = useState<any>(null) // For the View Popup
  const [editingContact, setEditingContact] = useState<any>(null) // For the Edit Form

  // Data State (Starts completely empty for testing!)
  const [contacts, setContacts] = useState<any[]>([])

  useEffect(() => {
    const id = params.id as string
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const found = savedCompanies.find((c: any) => c.id === id)
    setCompany(found || null)
    setLoading(false)
  }, [params.id])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <div className="p-10 text-center">Company Not Found</div>

  // --- HANDLERS ---
  const generateId = () => `${company.id}-CNT-${Math.floor(1000 + Math.random() * 9000)}`

  const handleEditClick = (contact: any) => {
    setEditingContact(contact)
    setIsPrimaryChecked(contact.isPrimary)
    setShowAddContact(true)
  }

  const handleCancelForm = () => {
    setShowAddContact(false)
    setEditingContact(null)
    setIsPrimaryChecked(false)
  }

  const handleSaveContact = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    
    // If setting as primary, uncheck all others
    let updatedContacts = [...contacts]
    if (isPrimaryChecked) {
      updatedContacts = updatedContacts.map(c => ({ ...c, isPrimary: false }))
    }

    if (editingContact) {
      // UPDATE EXISTING RECORD
      updatedContacts = updatedContacts.map(c => {
        if (c.id === editingContact.id) {
          return {
            ...c,
            firstName: formData.get("firstName"),
            lastName: formData.get("lastName"),
            role: formData.get("role"),
            email: formData.get("email"),
            phone: formData.get("phone"),
            dlNumber: formData.get("dlNumber"),
            dlState: formData.get("dlState"),
            dlExpiry: formData.get("dlExpiry"),
            isPrimary: isPrimaryChecked,
          }
        }
        return c
      })
    } else {
      // ADD NEW RECORD
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
        isArchived: false,
        createdAt: new Date().toISOString()
      }
      updatedContacts = [newContact, ...updatedContacts]
    }
    
    setContacts(updatedContacts)
    handleCancelForm()
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
          <Button size="sm" onClick={() => setShowAddContact(true)}>
            <Plus className="size-4 mr-1"/> Add Contact
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          
          {/* INLINE ADD/EDIT CONTACT FORM */}
          {showAddContact && (
            <form onSubmit={handleSaveContact} className="p-6 bg-muted/10 border-b border-primary/20">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-sm">{editingContact ? "Edit Personnel Profile" : "Add New Personnel"}</h4>
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
                  <div className="space-y-2 mt-4"><Label>First Name *</Label><Input name="firstName" defaultValue={editingContact?.firstName} required /></div>
                  <div className="space-y-2 mt-4"><Label>Last Name *</Label><Input name="lastName" defaultValue={editingContact?.lastName} required /></div>
                  <div className="space-y-2">
                    <Label>Role / Title *</Label>
                    <Select name="role" defaultValue={editingContact?.role} required>
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
                  <div className="space-y-2"><Label>Phone Number *</Label><Input name="phone" defaultValue={editingContact?.phone} required /></div>
                  <div className="space-y-2 sm:col-span-2"><Label>Email Address *</Label><Input name="email" type="email" defaultValue={editingContact?.email} required /></div>
                </div>

                {/* Identity / DL Info */}
                <div className="space-y-4 bg-background p-4 rounded-xl border">
                  <div className="flex items-center gap-2 mb-2">
                    <CreditCard className="size-4 text-primary" />
                    <Label className="text-primary font-semibold">Identity (Driver's License)</Label>
                  </div>
                  <div className="space-y-2"><Label className="text-xs">License Number</Label><Input name="dlNumber" defaultValue={editingContact?.dlNumber} placeholder="e.g. 123456789" /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2"><Label className="text-xs">Issuing State/Prov</Label><Input name="dlState" defaultValue={editingContact?.dlState} placeholder="e.g. AB, TX" maxLength={2} /></div>
                    <div className="space-y-2"><Label className="text-xs">Expiry Date</Label><Input name="dlExpiry" type="date" defaultValue={editingContact?.dlExpiry} /></div>
                  </div>
                </div>
              </div>

              <DocumentUploadZone 
                title="Upload ID / License"
                description="Drop a scan of the contact's driver's license or government ID here for OCR verification."
              />

              <div className="flex justify-end gap-2 mt-6">
                <Button type="button" variant="outline" onClick={handleCancelForm}>Cancel</Button>
                <Button type="submit">{editingContact ? "Save Updates" : "Save Contact"}</Button>
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
                No corporate personnel records found. Click "Add Contact" to begin.
              </div>
            ) : (
              contacts.filter(c => !c.isArchived).map((contact) => (
                <div key={contact.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-center hover:bg-muted/5 transition-colors">
                  
                  <div className="col-span-3 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{contact.firstName} {contact.lastName}</span>
                      {contact.isPrimary && <Badge className="text-[9px] h-4 px-1.5 uppercase">Primary</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">{contact.role}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/60">{contact.id}</span>
                  </div>

                  <div className="col-span-4 flex flex-col gap-1 text-sm">
                    <div className="flex items-center gap-2"><Phone className="size-3.5 text-muted-foreground"/> {contact.phone}</div>
                    <div className="flex items-center gap-2"><Mail className="size-3.5 text-muted-foreground"/> {contact.email}</div>
                  </div>

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

                  <div className="col-span-2 text-right flex justify-end gap-2 md:mt-0 mt-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs bg-background" onClick={() => setSelectedContact(contact)}>
                      View
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleEditClick(contact)}>
                      Edit
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* 4. DETAILED VIEW POPUP (MODAL) */}
      <Dialog open={!!selectedContact} onOpenChange={(open) => !open && setSelectedContact(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 gap-0">
          
          {selectedContact && (
            <>
              {/* Modal Header */}
              <div className="bg-muted/30 border-b p-6 flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex shrink-0 items-center justify-center size-14 rounded-full bg-primary/10 text-primary border border-primary/20">
                    <User className="size-6" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl">{selectedContact.firstName} {selectedContact.lastName}</DialogTitle>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-muted-foreground">{selectedContact.role}</span>
                      <span className="text-muted-foreground/30">•</span>
                      <span className="text-xs font-mono text-muted-foreground">{selectedContact.id}</span>
                      {selectedContact.isPrimary && <Badge className="text-[9px] h-4 px-1.5 uppercase ml-2">Primary Contact</Badge>}
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Body: Split View */}
              <div className="p-6 grid md:grid-cols-2 gap-8">
                
                {/* Left Side: Data Details */}
                <div className="space-y-6">
                  
                  <div>
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Contact Information</h4>
                    <div className="space-y-3 bg-muted/10 p-4 rounded-lg border">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><Phone className="size-4"/> Phone</span>
                        <span className="text-sm font-medium">{selectedContact.phone}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><Mail className="size-4"/> Email</span>
                        <span className="text-sm font-medium">{selectedContact.email}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Identity Records</h4>
                    <div className="space-y-3 bg-muted/10 p-4 rounded-lg border">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><CreditCard className="size-4"/> DL Number</span>
                        <span className="text-sm font-mono font-medium">{selectedContact.dlNumber || "—"}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Issuing State/Prov</span>
                        <span className="text-sm font-medium">{selectedContact.dlState || "—"}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Expiry Date</span>
                        <span className="text-sm font-medium">{selectedContact.dlExpiry || "—"}</span>
                      </div>
                    </div>
                  </div>
                  
                </div>

                {/* Right Side: Document Preview Box */}
                <div className="flex flex-col h-full">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Document Preview</h4>
                  <div className="flex-1 min-h-[250px] bg-muted/20 border-2 border-dashed rounded-lg flex flex-col items-center justify-center p-6 text-center">
                    <ImageIcon className="size-12 text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-foreground">No Document Rendered</p>
                    <p className="text-xs text-muted-foreground max-w-[200px] mt-1">
                      Uploaded identification documents will be displayed here for visual verification.
                    </p>
                  </div>
                </div>

              </div>

              {/* Modal Footer: Activity & Notes */}
              <div className="border-t bg-muted/5 p-6 pt-4">
                <Tabs defaultValue="notes" className="w-full">
                  <TabsList className="grid w-full max-w-[400px] grid-cols-2">
                    <TabsTrigger value="notes">Notes</TabsTrigger>
                    <TabsTrigger value="activity">Activity Log</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="notes" className="mt-4 space-y-3">
                    <Textarea placeholder={`Add a note regarding ${selectedContact.firstName}...`} className="min-h-[100px] bg-background text-sm resize-none" />
                    <Button size="sm">Save Note</Button>
                  </TabsContent>

                  <TabsContent value="activity" className="mt-4">
                    <div className="bg-background border rounded-lg p-4 flex items-start gap-3">
                      <div className="flex shrink-0 items-center justify-center size-8 rounded-full border border-primary/20 text-primary bg-primary/5">
                        <FileText className="size-4" />
                      </div>
                      <div className="flex flex-col">
                        <p className="text-sm font-medium">Record Created</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {selectedContact.createdAt ? new Date(selectedContact.createdAt).toLocaleString() : "Unknown"} • by System Admin
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
