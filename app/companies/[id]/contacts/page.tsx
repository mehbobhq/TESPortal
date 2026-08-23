"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Building2, Plus, FileText, CheckCircle2, User, Phone, Mail, ScanLine, CreditCard, Image as ImageIcon, Trash2, Link as LinkIcon, ExternalLink, Send, Sparkles } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

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

export default function ContactsPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  
  // UI States
  const [showAddContact, setShowAddContact] = useState(false)
  const [isPrimaryChecked, setIsPrimaryChecked] = useState(false)
  const [selectedContact, setSelectedContact] = useState<any>(null)
  const [editingContact, setEditingContact] = useState<any>(null)

  const [contacts, setContacts] = useState<any[]>([])

  useEffect(() => {
    const id = params.id as string
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const found = savedCompanies.find((c: any) => c.id === id)
    setCompany(found || null)
    
    if (found) {
      const sampleContact = {
        id: `${id}-CNT-9771`,
        globalId: `USR-88492`,
        firstName: "Tejinder",
        lastName: "Khosa",
        role: "Owner",
        email: "john@abc.com",
        phone: "5872064793",
        dlNumber: "AB12345678",
        dlState: "AB",
        dlExpiry: "2028-02-09",
        isPrimary: true,
        isArchived: false,
        createdAt: new Date().toISOString(),
        notes: "OOO from Sept 10 to Sept 15. CC Dispatch on all logbook queries during this time.",
        linkedEntities: [
          { companyId: id, companyName: found.name, role: "Owner" },
          { companyId: "CMP-44112", companyName: "Khosa Transport LLC", role: "Director" }
        ],
        hasDocumentScanned: true
      }
      setContacts([sampleContact])
      setSelectedContact(sampleContact) 
    }
    setLoading(false)
  }, [params.id])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <div className="p-10 text-center">Company Not Found</div>

  const generateId = () => `${company.id}-CNT-${Math.floor(1000 + Math.random() * 9000)}`
  const generateGlobalId = () => `USR-${Math.floor(10000 + Math.random() * 90000)}`

  const handleEditClick = (contact: any) => {
    setEditingContact(contact)
    setIsPrimaryChecked(contact.isPrimary)
    setShowAddContact(true)
  }

  const handleDeleteClick = (contactId: string) => {
    setContacts(contacts.filter(c => c.id !== contactId))
    if (selectedContact?.id === contactId) setSelectedContact(null)
  }

  const handleCancelForm = () => {
    setShowAddContact(false)
    setEditingContact(null)
    setIsPrimaryChecked(false)
  }

  const handleSaveContact = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    
    let updatedContacts = [...contacts]
    if (isPrimaryChecked) {
      updatedContacts = updatedContacts.map(c => ({ ...c, isPrimary: false }))
    }

    if (editingContact) {
      updatedContacts = updatedContacts.map(c => {
        if (c.id === editingContact.id) {
          const updated = {
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
          if (selectedContact?.id === updated.id) setSelectedContact(updated)
          return updated
        }
        return c
      })
    } else {
      const newContact = {
        id: generateId(),
        globalId: generateGlobalId(),
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
        createdAt: new Date().toISOString(),
        notes: "",
        linkedEntities: [{ companyId: company.id, companyName: company.name, role: formData.get("role") }],
        hasDocumentScanned: formData.get("dlNumber") ? true : false
      }
      updatedContacts = [newContact, ...updatedContacts]
      setSelectedContact(newContact)
    }
    
    setContacts(updatedContacts)
    handleCancelForm()
  }

  // --- STRICT SORTING ALGORITHM ---
  // This guarantees that Primary contacts are ALWAYS pinned to the top of the ledger.
  const sortedContacts = [...contacts].sort((a, b) => {
    if (a.isPrimary === b.isPrimary) return 0;
    return a.isPrimary ? -1 : 1;
  });

  return (
    <div className="flex flex-col gap-6 pb-10 max-w-[1400px]">
      
      {/* 1. HEADER */}
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
      </div>

      {/* 2. MASTER-DETAIL GRID */}
      <div className="grid lg:grid-cols-3 gap-6 items-start">
        
        {/* LEFT COLUMN: THE LEDGER (Span 2) */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="bg-muted/30 py-3 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">Personnel Directory</CardTitle>
                <CardDescription className="text-xs mt-1">Officers, managers, and administrative contacts.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" onClick={() => { setShowAddContact(true); setEditingContact(null); }}>
                  <ScanLine className="size-4 mr-1"/> Scan ID (OCR)
                </Button>
                <Button size="sm" onClick={() => { setShowAddContact(true); setEditingContact(null); setIsPrimaryChecked(false); }}>
                  <Plus className="size-4 mr-1"/> Manual Add
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              
              {/* INLINE FORM */}
              {showAddContact && (
                <form onSubmit={handleSaveContact} className="p-6 bg-primary/5 border-b border-primary/20">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-semibold text-sm text-primary">{editingContact ? "Edit Personnel Profile" : "Add New Personnel"}</h4>
                    <div className="flex items-center space-x-2 bg-background border px-3 py-1.5 rounded-md">
                      <Checkbox id="isPrimary" checked={isPrimaryChecked} onCheckedChange={(c) => setIsPrimaryChecked(c === true)} />
                      <Label htmlFor="isPrimary" className="text-xs font-medium cursor-pointer">Set as Primary</Label>
                    </div>
                  </div>

                  {/* OCR FIRST ARCHITECTURE: Upload is at the absolute top of the creation flow */}
                  <div className="mb-6">
                    <DocumentUploadZone 
                      isAutoFill={true}
                      title="Upload ID for Auto-Fill"
                      description="Drop a Driver's License or Government ID here. AI will extract Name, DOB, and License details instantly."
                    />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>First Name *</Label><Input name="firstName" defaultValue={editingContact?.firstName} required /></div>
                    <div className="space-y-2"><Label>Last Name *</Label><Input name="lastName" defaultValue={editingContact?.lastName} required /></div>
                    <div className="space-y-2">
                      <Label>Role / Title *</Label>
                      <Select name="role" defaultValue={editingContact?.role} required>
                        <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Owner">Owner / President</SelectItem>
                          <SelectItem value="Safety Manager">Safety Manager</SelectItem>
                          <SelectItem value="Dispatcher">Dispatcher</SelectItem>
                          <SelectItem value="Billing">Billing / Accounting</SelectItem>
                          <SelectItem value="Consultant">Third-Party Consultant</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Phone Number *</Label><Input name="phone" defaultValue={editingContact?.phone} required /></div>
                    <div className="space-y-2 sm:col-span-2"><Label>Email Address *</Label><Input name="email" type="email" defaultValue={editingContact?.email} required /></div>
                  </div>

                  <div className="mt-4 p-4 bg-background rounded-lg border space-y-4">
                    <Label className="font-semibold flex items-center gap-2"><CreditCard className="size-4 text-primary"/> Identity (Driver's License)</Label>
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="space-y-2 sm:col-span-1"><Label className="text-xs">License No.</Label><Input name="dlNumber" defaultValue={editingContact?.dlNumber} /></div>
                      <div className="space-y-2"><Label className="text-xs">State/Prov</Label><Input name="dlState" defaultValue={editingContact?.dlState} maxLength={2} /></div>
                      <div className="space-y-2"><Label className="text-xs">Expiry</Label><Input name="dlExpiry" type="date" defaultValue={editingContact?.dlExpiry} /></div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 mt-6">
                    <Button type="button" variant="outline" onClick={handleCancelForm}>Cancel</Button>
                    <Button type="submit">{editingContact ? "Save Updates" : "Save Contact"}</Button>
                  </div>
                </form>
              )}

              {/* TABLE */}
              <div className="divide-y text-sm">
                <div className="grid grid-cols-12 gap-4 p-4 font-semibold text-muted-foreground bg-muted/10 text-xs uppercase tracking-wider hidden md:grid">
                  <div className="col-span-4">Personnel</div>
                  <div className="col-span-5">Contact Info</div>
                  <div className="col-span-3 text-right">Actions</div>
                </div>

                {sortedContacts.length === 0 ? (
                  <div className="p-10 text-center flex flex-col items-center justify-center">
                     <ScanLine className="size-10 text-muted-foreground/30 mb-3" />
                     <p className="text-sm font-medium text-muted-foreground">No records found.</p>
                     <p className="text-xs text-muted-foreground mt-1 max-w-[250px]">Click "Scan ID (OCR)" to instantly create a profile from a document.</p>
                  </div>
                ) : (
                  sortedContacts.map((contact) => {
                    const isSelected = selectedContact?.id === contact.id
                    return (
                      <div 
                        key={contact.id} 
                        onClick={() => setSelectedContact(contact)}
                        className={`grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-center transition-colors cursor-pointer group border-l-4 ${isSelected ? 'bg-primary/5 border-primary' : 'border-transparent hover:bg-muted/30'}`}
                      >
                        <div className="col-span-4 flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold ${isSelected ? 'text-primary' : 'text-foreground'}`}>{contact.firstName} {contact.lastName}</span>
                            {contact.isPrimary && <Badge className="text-[9px] h-4 px-1.5 uppercase">Primary</Badge>}
                          </div>
                          <span className="text-xs text-muted-foreground">{contact.role}</span>
                        </div>

                        <div className="col-span-5 flex flex-col gap-1 text-sm">
                          <div className="flex items-center gap-2"><Phone className="size-3.5 text-muted-foreground"/> {contact.phone}</div>
                          <div className="flex items-center gap-2"><Mail className="size-3.5 text-muted-foreground"/> {contact.email}</div>
                        </div>

                        <div className="col-span-3 text-right flex justify-end gap-2 md:mt-0 mt-2">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); handleEditClick(contact); }}>
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); handleDeleteClick(contact.id); }}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: INSPECTOR SIDEBAR (Span 1) */}
        <div className="lg:col-span-1 sticky top-6">
          {!selectedContact ? (
            <Card className="bg-muted/10 border-dashed">
              <CardContent className="flex flex-col items-center justify-center p-10 text-center text-muted-foreground h-[400px]">
                <User className="size-10 mb-4 opacity-20" />
                <p className="text-sm font-medium">No Contact Selected</p>
                <p className="text-xs mt-1">Select a row from the directory to view activity, notes, and documents.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="shadow-lg border-primary/20">
              <CardHeader className="bg-primary/5 py-4 border-b">
                <div className="flex items-center gap-3">
                  <div className="flex shrink-0 items-center justify-center size-10 rounded-full bg-background border text-primary">
                    <User className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{selectedContact.firstName} {selectedContact.lastName}</CardTitle>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{selectedContact.role}</span>
                      <span className="text-[10px] font-mono text-muted-foreground/50 border px-1 rounded bg-background" title="Global Universal ID">{selectedContact.globalId}</span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="p-0">
                <Tabs defaultValue="notes" className="w-full">
                  <TabsList className="grid w-full grid-cols-3 rounded-none border-b bg-transparent h-12 p-0">
                    <TabsTrigger value="notes" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none">Notes</TabsTrigger>
                    <TabsTrigger value="activity" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none">Activity</TabsTrigger>
                    <TabsTrigger value="id" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none">ID / Links</TabsTrigger>
                  </TabsList>
                  
                  {/* NOTES TAB */}
                  <TabsContent value="notes" className="m-0 p-4 space-y-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Internal Notes</Label>
                      <Textarea 
                        defaultValue={selectedContact.notes}
                        placeholder={`Add a note regarding ${selectedContact.firstName}...`} 
                        className="min-h-[150px] bg-muted/20 text-sm resize-none focus-visible:ring-primary" 
                      />
                    </div>
                    <Button size="sm" className="w-full">Save Note</Button>
                  </TabsContent>

                  {/* ACTIVITY TAB */}
                  <TabsContent value="activity" className="m-0 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Communication Log</Label>
                      <Badge variant="secondary" className="text-[10px]">15 Emails</Badge>
                    </div>
                    
                    <div className="space-y-3 h-[250px] overflow-y-auto pr-2">
                      <div className="bg-muted/10 border rounded-lg p-3 text-sm">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-semibold text-xs flex items-center gap-1.5"><Send className="size-3 text-primary"/> Automated Reminder</span>
                          <span className="text-[10px] text-muted-foreground">Today, 9:00 AM</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">IFTA Q3 Filing deadline reminder sent to {selectedContact.email}.</p>
                      </div>

                      <div className="bg-muted/10 border rounded-lg p-3 text-sm">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-semibold text-xs flex items-center gap-1.5"><FileText className="size-3"/> Record Created</span>
                          <span className="text-[10px] text-muted-foreground">{new Date(selectedContact.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Profile created by System Admin.</p>
                      </div>
                    </div>
                  </TabsContent>

                  {/* ID & LINKS TAB */}
                  <TabsContent value="id" className="m-0 p-4 space-y-6 h-[400px] overflow-y-auto">
                    
                    {/* ID Preview or Upload Prompt */}
                    <div>
                      <Label className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-2 block">Identity Verification</Label>
                      
                      {selectedContact.hasDocumentScanned ? (
                        <div className="bg-muted/20 border rounded-lg p-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-mono font-medium">{selectedContact.dlNumber}</span>
                            <Badge variant="outline" className="text-[10px]">{selectedContact.dlState}</Badge>
                          </div>
                          <div className="h-[120px] border border-dashed rounded flex flex-col items-center justify-center bg-background text-muted-foreground">
                             <ImageIcon className="size-6 mb-1 opacity-50" />
                             <span className="text-[10px]">Preview Rendered</span>
                          </div>
                        </div>
                      ) : (
                        <DocumentUploadZone 
                          title="Missing Document"
                          description="Drop ID here to verify this profile."
                        />
                      )}
                    </div>

                    {/* Linked Entities */}
                    {selectedContact.linkedEntities && selectedContact.linkedEntities.length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-2 flex items-center gap-2">
                          <LinkIcon className="size-3.5" /> Associated Entities
                        </Label>
                        <div className="space-y-2">
                          {selectedContact.linkedEntities.map((entity: any, idx: number) => (
                            <Link href={`/companies/${entity.companyId}/profile`} key={idx}>
                              <div className="flex justify-between items-center bg-muted/10 hover:bg-primary/5 p-2 rounded border transition-colors group">
                                <div className="flex flex-col">
                                  <span className="text-xs font-medium group-hover:text-primary transition-colors truncate max-w-[120px]">{entity.companyName}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] text-muted-foreground bg-background px-1.5 py-0.5 rounded border">{entity.role}</span>
                                  <ExternalLink className="size-3 text-muted-foreground/50 group-hover:text-primary" />
                                </div>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>

      </div>
    </div>
  )
}
