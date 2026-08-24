"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileCheck2,
  FileText,
  History,
  Link2,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Relationship = {
  id: string
  companyId: string
  companyName: string
  role: string
  status: "active" | "ended"
  startDate: string
  endDate?: string
  source: "manual" | "document" | "system"
}

type Evidence = {
  id: string
  type: "Government ID" | "Driver Licence" | "Corporate Record" | "Other"
  fileName: string
  uploadedAt: string
  status: "uploaded" | "review_required" | "verified"
  confidence?: number
  source: "user_upload" | "system"
}

type ContactEvent = {
  id: string
  type:
    | "CONTACT_CREATED"
    | "CONTACT_UPDATED"
    | "CONTACT_ARCHIVED"
    | "CONTACT_RESTORED"
    | "PRIMARY_CHANGED"
    | "RELATIONSHIP_ADDED"
    | "NOTE_ADDED"
    | "DOCUMENT_ATTACHED"
    | "IDENTITY_REVIEW_REQUESTED"
  timestamp: string
  actor: string
  description: string
}

type Contact = {
  id: string
  globalId: string
  firstName: string
  lastName: string
  role: string
  email: string
  phone: string
  isPrimary: boolean
  isArchived: boolean
  createdAt: string
  updatedAt: string
  notes: string
  identityStatus: "unverified" | "verified" | "review_required"
  identityConfidence?: number
  relationships: Relationship[]
  evidence: Evidence[]
  events: ContactEvent[]
}

const CONTACT_STORAGE = "tes_contacts_v2"

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

function now() {
  return new Date().toISOString()
}

function appendEvent(
  contact: Contact,
  type: ContactEvent["type"],
  description: string
): Contact {
  const event: ContactEvent = {
    id: makeId("EVT"),
    type,
    timestamp: now(),
    actor: "Current User",
    description,
  }

  return {
    ...contact,
    events: [event, ...(contact.events || [])],
    updatedAt: now(),
  }
}

function getInitialContacts(company: any): Contact[] {
  return []
}

export default function ContactsPage() {
  const params = useParams()
  const router = useRouter()

  const companyId = params.id as string

  const [company, setCompany] = useState<any>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)

  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("active")
  const [verificationFilter, setVerificationFilter] = useState("all")

  const [isPrimary, setIsPrimary] = useState(false)

  const [noteDraft, setNoteDraft] = useState("")

  useEffect(() => {
    const savedCompanies = JSON.parse(
      localStorage.getItem("tes_companies") || "[]"
    )

    const found = savedCompanies.find((c: any) => c.id === companyId)

    setCompany(found || null)

    const allContacts = JSON.parse(
      localStorage.getItem(CONTACT_STORAGE) || "null"
    )

    if (allContacts) {
      setContacts(allContacts)
    } else {
      const initial = getInitialContacts(found)
      setContacts(initial)
      localStorage.setItem(CONTACT_STORAGE, JSON.stringify(initial))
    }

    setLoading(false)
  }, [companyId])

  useEffect(() => {
    if (!loading) {
      localStorage.setItem(CONTACT_STORAGE, JSON.stringify(contacts))
    }
  }, [contacts, loading])

  const companyContacts = useMemo(() => {
    return contacts.filter((contact) =>
      contact.relationships.some(
        (relationship) =>
          relationship.companyId === companyId &&
          relationship.status === "active"
      )
    )
  }, [contacts, companyId])

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase()

    return companyContacts
      .filter((contact) => {
        if (statusFilter === "active" && contact.isArchived) return false
        if (statusFilter === "archived" && !contact.isArchived) return false

        if (
          roleFilter !== "all" &&
          !contact.relationships.some(
            (relationship) =>
              relationship.companyId === companyId &&
              relationship.role === roleFilter &&
              relationship.status === "active"
          )
        ) {
          return false
        }

        if (
          verificationFilter !== "all" &&
          contact.identityStatus !== verificationFilter
        ) {
          return false
        }

        if (!query) return true

        return (
          `${contact.firstName} ${contact.lastName}`
            .toLowerCase()
            .includes(query) ||
          contact.email.toLowerCase().includes(query) ||
          contact.phone.toLowerCase().includes(query) ||
          contact.globalId.toLowerCase().includes(query)
        )
      })
      .sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) {
          return a.isPrimary ? -1 : 1
        }

        return `${a.firstName} ${a.lastName}`.localeCompare(
          `${b.firstName} ${b.lastName}`
        )
      })
  }, [
    companyContacts,
    companyId,
    roleFilter,
    search,
    statusFilter,
    verificationFilter,
  ])

  const selectedContact = contacts.find((c) => c.id === selectedId) || null

  const activeCount = companyContacts.filter((c) => !c.isArchived).length

  const primaryCount = companyContacts.filter(
    (c) => c.isPrimary && !c.isArchived
  ).length

  const verifiedCount = companyContacts.filter(
    (c) => c.identityStatus === "verified" && !c.isArchived
  ).length

  const reviewCount = companyContacts.filter(
    (c) => c.identityStatus === "review_required" && !c.isArchived
  ).length

  const openCreate = () => {
    setEditingContact(null)
    setIsPrimary(false)
    setShowForm(true)
  }

  const openEdit = (contact: Contact) => {
    setEditingContact(contact)
    setIsPrimary(contact.isPrimary)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingContact(null)
    setIsPrimary(false)
  }

  const saveContact = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = new FormData(event.currentTarget)

    const firstName = String(form.get("firstName") || "").trim()
    const lastName = String(form.get("lastName") || "").trim()
    const role = String(form.get("role") || "")
    const email = String(form.get("email") || "").trim()
    const phone = String(form.get("phone") || "").trim()

    if (!firstName || !lastName || !role || !email || !phone) return

    let updatedContacts = [...contacts]

    if (editingContact) {
      updatedContacts = updatedContacts.map((contact) => {
        if (contact.id !== editingContact.id) return contact

        let updated: Contact = {
          ...contact,
          firstName,
          lastName,
          role,
          email,
          phone,
          isPrimary,
          updatedAt: now(),
        }

        updated = appendEvent(
          updated,
          "CONTACT_UPDATED",
          `Contact profile updated for ${firstName} ${lastName}.`
        )

        return updated
      })

      if (isPrimary) {
        updatedContacts = updatedContacts.map((contact) => {
          if (contact.id === editingContact.id) return contact

          const belongsToCompany = contact.relationships.some(
            (relationship) =>
              relationship.companyId === companyId &&
              relationship.status === "active"
          )

          if (!belongsToCompany) return contact

          if (!contact.isPrimary) return contact

          return appendEvent(
            {
              ...contact,
              isPrimary: false,
            },
            "PRIMARY_CHANGED",
            `Primary contact designation transferred to ${firstName} ${lastName}.`
          )
        })
      }
    } else {
      const relationship: Relationship = {
        id: makeId("REL"),
        companyId,
        companyName: company.name,
        role,
        status: "active",
        startDate: new Date().toISOString().slice(0, 10),
        source: "manual",
      }

      const contact: Contact = {
        id: makeId("CNT"),
        globalId: makeId("USR"),
        firstName,
        lastName,
        role,
        email,
        phone,
        isPrimary,
        isArchived: false,
        createdAt: now(),
        updatedAt: now(),
        notes: "",
        identityStatus: "unverified",
        relationships: [relationship],
        evidence: [],
        events: [],
      }

      const created = appendEvent(
        contact,
        "CONTACT_CREATED",
        `Contact created and linked to ${company.name}.`
      )

      updatedContacts = [created, ...updatedContacts]

      if (isPrimary) {
        updatedContacts = updatedContacts.map((existing) => {
          if (existing.id === created.id) return existing

          const belongsToCompany = existing.relationships.some(
            (relationship) =>
              relationship.companyId === companyId &&
              relationship.status === "active"
          )

          if (!belongsToCompany || !existing.isPrimary) return existing

          return appendEvent(
            {
              ...existing,
              isPrimary: false,
            },
            "PRIMARY_CHANGED",
            `Primary contact designation transferred to ${firstName} ${lastName}.`
          )
        })
      }

      setSelectedId(created.id)
    }

    setContacts(updatedContacts)
    closeForm()
  }

  const archiveContact = (contact: Contact) => {
    const reason = window.prompt(
      `Archive ${contact.firstName} ${contact.lastName}?\n\nEnter an archive reason:`
    )

    if (!reason?.trim()) return

    setContacts((current) =>
      current.map((item) => {
        if (item.id !== contact.id) return item

        return appendEvent(
          {
            ...item,
            isArchived: true,
            isPrimary: false,
          },
          "CONTACT_ARCHIVED",
          `Contact archived. Reason: ${reason.trim()}`
        )
      })
    )
  }

  const restoreContact = (contact: Contact) => {
    setContacts((current) =>
      current.map((item) => {
        if (item.id !== contact.id) return item

        return appendEvent(
          {
            ...item,
            isArchived: false,
          },
          "CONTACT_RESTORED",
          "Contact restored to the operational directory."
        )
      })
    )
  }

  const saveNote = () => {
    if (!selectedContact || !noteDraft.trim()) return

    setContacts((current) =>
      current.map((contact) => {
        if (contact.id !== selectedContact.id) return contact

        return appendEvent(
          {
            ...contact,
            notes: noteDraft.trim(),
          },
          "NOTE_ADDED",
          "Internal contact note updated."
        )
      })
    )
  }

  const attachDocument = (file: File | undefined) => {
    if (!file || !selectedContact) return

    const evidence: Evidence = {
      id: makeId("DOC"),
      type: "Government ID",
      fileName: file.name,
      uploadedAt: now(),
      status: "review_required",
      source: "user_upload",
    }

    setContacts((current) =>
      current.map((contact) => {
        if (contact.id !== selectedContact.id) return contact

        return appendEvent(
          {
            ...contact,
            evidence: [evidence, ...contact.evidence],
            identityStatus: "review_required",
          },
          "DOCUMENT_ATTACHED",
          `Identity document "${file.name}" attached. Human review required before verification.`
        )
      })
    )
  }

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Loading contact workspace...
      </div>
    )
  }

  if (!company) {
    return (
      <div className="p-10 text-center">
        <p className="font-medium">Company not found</p>
      </div>
    )
  }

  return (
    <div className="max-w-[1500px] space-y-6 pb-12">
      {/* HEADER */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              router.push(`/companies/${company.id}/profile`)
            }
          >
            <ArrowLeft className="size-4" />
          </Button>

          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                Contacts & Relationships
              </h1>

              <Badge variant="outline" className="font-mono text-[10px]">
                {company.id}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground mt-1">
              {company.name} · Longitudinal personnel and relationship records
            </p>
          </div>

          <Button onClick={openCreate}>
            <Plus className="size-4 mr-2" />
            Add Contact
          </Button>
        </div>

        {/* STATUS STRIP */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Users className="size-4" />
                Active Contacts
              </div>
              <p className="text-2xl font-semibold mt-1">{activeCount}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <UserCheck className="size-4" />
                Primary
              </div>
              <p className="text-2xl font-semibold mt-1">{primaryCount}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <ShieldCheck className="size-4" />
                Verified
              </div>
              <p className="text-2xl font-semibold mt-1">{verifiedCount}</p>
            </CardContent>
          </Card>

          <Card
            className={
              reviewCount > 0
                ? "border-amber-300 bg-amber-50/40 dark:bg-amber-950/10"
                : ""
            }
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Sparkles className="size-4" />
                Review Required
              </div>
              <p className="text-2xl font-semibold mt-1">{reviewCount}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* WORKSPACE */}
      <div className="grid xl:grid-cols-[minmax(0,1fr)_430px] gap-6 items-start">
        {/* REGISTER */}
        <Card>
          <CardHeader className="border-b bg-muted/20">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
              <div>
                <CardTitle className="text-base">
                  Personnel Register
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  People connected to this company, including relationship
                  status and identity state.
                </CardDescription>
              </div>

              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search personnel..."
                    className="pl-9 w-[220px]"
                  />
                </div>

                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    <SelectItem value="Owner">Owner</SelectItem>
                    <SelectItem value="Safety Manager">
                      Safety Manager
                    </SelectItem>
                    <SelectItem value="Dispatcher">Dispatcher</SelectItem>
                    <SelectItem value="Billing">Billing</SelectItem>
                    <SelectItem value="Consultant">Consultant</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={verificationFilter}
                  onValueChange={setVerificationFilter}
                >
                  <SelectTrigger className="w-[155px]">
                    <SelectValue placeholder="Identity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All identity states</SelectItem>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="unverified">Unverified</SelectItem>
                    <SelectItem value="review_required">
                      Review required
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={statusFilter}
                  onValueChange={setStatusFilter}
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {showForm && (
              <form
                onSubmit={saveContact}
                className="p-6 border-b bg-primary/[0.025]"
              >
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="font-semibold text-sm">
                      {editingContact
                        ? "Edit Contact Record"
                        : "Create Contact Record"}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Manual entry creates an unverified record. Evidence can
                      be attached separately.
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={closeForm}
                  >
                    <XCircle className="size-4" />
                  </Button>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>First Name *</Label>
                    <Input
                      name="firstName"
                      defaultValue={editingContact?.firstName || ""}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Last Name *</Label>
                    <Input
                      name="lastName"
                      defaultValue={editingContact?.lastName || ""}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Role / Relationship *</Label>
                    <Select
                      name="role"
                      defaultValue={
                        editingContact?.relationships.find(
                          (r) =>
                            r.companyId === companyId &&
                            r.status === "active"
                        )?.role || ""
                      }
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select relationship" />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="Owner">Owner / President</SelectItem>
                        <SelectItem value="Safety Manager">
                          Safety Manager
                        </SelectItem>
                        <SelectItem value="Dispatcher">
                          Dispatcher
                        </SelectItem>
                        <SelectItem value="Billing">
                          Billing / Accounting
                        </SelectItem>
                        <SelectItem value="Consultant">
                          Third-Party Consultant
                        </SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Phone *</Label>
                    <Input
                      name="phone"
                      defaultValue={editingContact?.phone || ""}
                      required
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label>Email *</Label>
                    <Input
                      name="email"
                      type="email"
                      defaultValue={editingContact?.email || ""}
                      required
                    />
                  </div>
                </div>

                <div className="mt-5 p-4 border rounded-lg bg-background">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">
                        Primary company contact
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Setting this contact as primary will remove the primary
                        designation from the other active contact for this
                        company. The change is recorded in history.
                      </p>
                    </div>

                    <Checkbox
                      checked={isPrimary}
                      onCheckedChange={(checked) =>
                        setIsPrimary(checked === true)
                      }
                    />
                  </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeForm}
                  >
                    Cancel
                  </Button>

                  <Button type="submit">
                    {editingContact ? "Save Changes" : "Create Contact"}
                  </Button>
                </div>
              </form>
            )}

            {filteredContacts.length === 0 ? (
              <div className="p-16 text-center">
                <div className="mx-auto size-12 rounded-full bg-muted flex items-center justify-center">
                  <Users className="size-6 text-muted-foreground" />
                </div>

                <h3 className="font-medium mt-4">
                  No contacts in this view
                </h3>

                <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1">
                  No matching contact records were found. Archived records
                  remain permanently retained and can be viewed from the
                  archived filter.
                </p>

                {statusFilter === "active" && (
                  <Button className="mt-5" onClick={openCreate}>
                    <Plus className="size-4 mr-2" />
                    Add First Contact
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {filteredContacts.map((contact) => {
                  const relationship = contact.relationships.find(
                    (r) =>
                      r.companyId === companyId && r.status === "active"
                  )

                  const selected = contact.id === selectedId

                  return (
                    <div
                      key={contact.id}
                      onClick={() => {
                        setSelectedId(contact.id)
                        setNoteDraft(contact.notes || "")
                      }}
                      className={`p-4 cursor-pointer transition-colors ${
                        selected
                          ? "bg-primary/[0.045] border-l-4 border-l-primary"
                          : "hover:bg-muted/30 border-l-4 border-l-transparent"
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center gap-4">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="size-10 shrink-0 rounded-full border bg-background flex items-center justify-center">
                            <User className="size-5 text-muted-foreground" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">
                                {contact.firstName} {contact.lastName}
                              </span>

                              {contact.isPrimary && !contact.isArchived && (
                                <Badge className="text-[9px] h-4">
                                  PRIMARY
                                </Badge>
                              )}

                              {contact.isArchived && (
                                <Badge
                                  variant="secondary"
                                  className="text-[9px] h-4"
                                >
                                  ARCHIVED
                                </Badge>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              <span className="text-xs text-muted-foreground">
                                {relationship?.role || contact.role}
                              </span>

                              <span className="text-[10px] font-mono text-muted-foreground">
                                {contact.globalId}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col text-xs gap-1 md:w-[230px]">
                          <div className="flex items-center gap-2">
                            <Mail className="size-3.5 text-muted-foreground" />
                            <span className="truncate">{contact.email}</span>
                          </div>

                          <span className="text-muted-foreground">
                            {contact.phone}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 md:w-[180px] md:justify-end">
                          {contact.identityStatus === "verified" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] gap-1"
                            >
                              <CheckCircle2 className="size-3" />
                              Verified
                            </Badge>
                          )}

                          {contact.identityStatus === "review_required" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] gap-1 border-amber-300 text-amber-700"
                            >
                              <Sparkles className="size-3" />
                              Review
                            </Badge>
                          )}

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation()
                              openEdit(contact)
                            }}
                          >
                            Edit
                          </Button>

                          {!contact.isArchived ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                archiveContact(contact)
                              }}
                              title="Archive contact"
                            >
                              <Archive className="size-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                restoreContact(contact)
                              }}
                              title="Restore contact"
                            >
                              <ArchiveRestore className="size-4" />
                            </Button>
                          )}

                          <ChevronRight className="size-4 text-muted-foreground/50" />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* INSPECTOR */}
        <div className="xl:sticky xl:top-6">
          {!selectedContact ? (
            <Card className="border-dashed">
              <CardContent className="min-h-[500px] flex flex-col items-center justify-center text-center p-10">
                <div className="size-14 rounded-full bg-muted flex items-center justify-center">
                  <User className="size-7 text-muted-foreground/50" />
                </div>

                <h3 className="font-medium mt-4">
                  Select a contact
                </h3>

                <p className="text-xs text-muted-foreground max-w-[280px] mt-1">
                  The inspector shows identity state, company relationships,
                  evidence, notes, and the contact's event history.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {/* PROFILE HEADER */}
              <CardHeader className="bg-primary/[0.035] border-b">
                <div className="flex items-start gap-3">
                  <div className="size-11 shrink-0 rounded-full bg-background border flex items-center justify-center">
                    <User className="size-5 text-primary" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base">
                      {selectedContact.firstName}{" "}
                      {selectedContact.lastName}
                    </CardTitle>

                    <CardDescription className="text-xs mt-1">
                      {selectedContact.role}
                    </CardDescription>

                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="text-[10px] font-mono border rounded px-1.5 py-0.5 bg-background">
                        {selectedContact.globalId}
                      </span>

                      {selectedContact.identityStatus === "verified" && (
                        <Badge
                          variant="outline"
                          className="text-[9px] gap-1"
                        >
                          <ShieldCheck className="size-3" />
                          Verified
                        </Badge>
                      )}

                      {selectedContact.identityStatus ===
                        "review_required" && (
                        <Badge
                          variant="outline"
                          className="text-[9px] border-amber-300 text-amber-700"
                        >
                          Review Required
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <Tabs defaultValue="overview">
                  <TabsList className="w-full grid grid-cols-4 rounded-none border-b bg-transparent h-12 p-0">
                    <TabsTrigger
                      value="overview"
                      className="rounded-none text-xs"
                    >
                      Overview
                    </TabsTrigger>

                    <TabsTrigger
                      value="evidence"
                      className="rounded-none text-xs"
                    >
                      Evidence
                    </TabsTrigger>

                    <TabsTrigger
                      value="activity"
                      className="rounded-none text-xs"
                    >
                      History
                    </TabsTrigger>

                    <TabsTrigger
                      value="notes"
                      className="rounded-none text-xs"
                    >
                      Notes
                    </TabsTrigger>
                  </TabsList>

                  {/* OVERVIEW */}
                  <TabsContent
                    value="overview"
                    className="p-4 space-y-5"
                  >
                    <section>
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Contact Information
                      </Label>

                      <div className="mt-3 space-y-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Email
                          </p>
                          <p className="mt-0.5">{selectedContact.email}</p>
                        </div>

                        <div>
                          <p className="text-xs text-muted-foreground">
                            Phone
                          </p>
                          <p className="mt-0.5">{selectedContact.phone}</p>
                        </div>
                      </div>
                    </section>

                    <section>
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Identity State
                        </Label>

                        {selectedContact.identityConfidence !== undefined && (
                          <span className="text-xs font-medium">
                            {selectedContact.identityConfidence}% confidence
                          </span>
                        )}
                      </div>

                      <div className="mt-3 p-3 rounded-lg border bg-muted/20">
                        {selectedContact.identityStatus === "verified" && (
                          <div className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="size-4 text-green-600" />
                            Identity verified
                          </div>
                        )}

                        {selectedContact.identityStatus === "unverified" && (
                          <div className="flex items-center gap-2 text-sm">
                            <Clock3 className="size-4 text-muted-foreground" />
                            Identity not yet verified
                          </div>
                        )}

                        {selectedContact.identityStatus ===
                          "review_required" && (
                          <div className="flex items-center gap-2 text-sm">
                            <Sparkles className="size-4 text-amber-600" />
                            Human identity review required
                          </div>
                        )}
                      </div>
                    </section>

                    <section>
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Company Relationship
                      </Label>

                      <div className="mt-3 space-y-2">
                        {selectedContact.relationships.map(
                          (relationship) => (
                            <Link
                              key={relationship.id}
                              href={`/companies/${relationship.companyId}/profile`}
                            >
                              <div className="p-3 border rounded-lg hover:bg-muted/30 transition-colors">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Building2 className="size-4 text-primary" />
                                    <span className="text-sm font-medium">
                                      {relationship.companyName}
                                    </span>
                                  </div>

                                  <ChevronRight className="size-4 text-muted-foreground" />
                                </div>

                                <div className="flex items-center gap-2 mt-2">
                                  <Badge
                                    variant="secondary"
                                    className="text-[9px]"
                                  >
                                    {relationship.role}
                                  </Badge>

                                  <span className="text-[10px] text-muted-foreground">
                                    {relationship.status}
                                  </span>
                                </div>
                              </div>
                            </Link>
                          )
                        )}
                      </div>
                    </section>
                  </TabsContent>

                  {/* EVIDENCE */}
                  <TabsContent
                    value="evidence"
                    className="p-4 space-y-5"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Identity Evidence
                          </Label>

                          <p className="text-xs text-muted-foreground mt-1">
                            Uploaded evidence remains traceable and requires
                            appropriate review before becoming verified.
                          </p>
                        </div>

                        <label>
                          <input
                            type="file"
                            className="hidden"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={(e) =>
                              attachDocument(e.target.files?.[0])
                            }
                          />

                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            asChild
                          >
                            <span className="cursor-pointer">
                              <Plus className="size-3.5 mr-1" />
                              Attach
                            </span>
                          </Button>
                        </label>
                      </div>

                      <div className="mt-4 space-y-2">
                        {selectedContact.evidence.length === 0 ? (
                          <div className="border border-dashed rounded-lg p-8 text-center">
                            <FileText className="size-7 mx-auto text-muted-foreground/40" />
                            <p className="text-xs font-medium mt-2">
                              No identity evidence attached
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              Add the appropriate source document when identity
                              verification is required.
                            </p>
                          </div>
                        ) : (
                          selectedContact.evidence.map((document) => (
                            <div
                              key={document.id}
                              className="border rounded-lg p-3"
                            >
                              <div className="flex items-start gap-3">
                                <FileCheck2 className="size-4 text-primary mt-0.5" />

                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium truncate">
                                    {document.fileName}
                                  </p>

                                  <p className="text-[10px] text-muted-foreground mt-1">
                                    {document.type} ·{" "}
                                    {new Date(
                                      document.uploadedAt
                                    ).toLocaleString()}
                                  </p>
                                </div>

                                <Badge
                                  variant="outline"
                                  className="text-[9px]"
                                >
                                  {document.status === "review_required"
                                    ? "Review"
                                    : document.status}
                                </Badge>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/30 border">
                      <div className="flex gap-2">
                        <Sparkles className="size-4 text-primary mt-0.5" />
                        <p className="text-xs text-muted-foreground">
                          AI/OCR may assist extraction in the production
                          pipeline, but extracted information must retain its
                          source and confidence and must not silently overwrite
                          authoritative records.
                        </p>
                      </div>
                    </div>
                  </TabsContent>

                  {/* HISTORY */}
                  <TabsContent
                    value="activity"
                    className="p-4"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <History className="size-4 text-primary" />
                      <div>
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Contact Event History
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Historical events are retained rather than deleted.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3 max-h-[430px] overflow-y-auto pr-1">
                      {selectedContact.events.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-10">
                          No events recorded.
                        </p>
                      ) : (
                        selectedContact.events.map((event) => (
                          <div
                            key={event.id}
                            className="border rounded-lg p-3"
                          >
                            <div className="flex items-start gap-3">
                              <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                                <History className="size-3.5 text-muted-foreground" />
                              </div>

                              <div className="min-w-0">
                                <p className="text-xs font-semibold">
                                  {event.type.replaceAll("_", " ")}
                                </p>

                                <p className="text-xs text-muted-foreground mt-1">
                                  {event.description}
                                </p>

                                <p className="text-[10px] text-muted-foreground mt-2">
                                  {event.actor} ·{" "}
                                  {new Date(
                                    event.timestamp
                                  ).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </TabsContent>

                  {/* NOTES */}
                  <TabsContent
                    value="notes"
                    className="p-4 space-y-4"
                  >
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Internal Notes
                      </Label>

                      <Textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="Add an operational note..."
                        className="mt-2 min-h-[180px] resize-none"
                      />

                      <p className="text-[10px] text-muted-foreground mt-2">
                        Note changes are recorded as contact events.
                      </p>
                    </div>

                    <Button
                      className="w-full"
                      onClick={saveNote}
                      disabled={!noteDraft.trim()}
                    >
                      Save Note
                    </Button>
                  </TabsContent>
                </Tabs>

                {/* FOOTER ACTION */}
                <div className="border-t p-3 bg-muted/10">
                  {selectedContact.isArchived ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => restoreContact(selectedContact)}
                    >
                      <ArchiveRestore className="size-4 mr-2" />
                      Restore Contact
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full text-destructive hover:text-destructive"
                      onClick={() => archiveContact(selectedContact)}
                    >
                      <Archive className="size-4 mr-2" />
                      Archive Contact
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
