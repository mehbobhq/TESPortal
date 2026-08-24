"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileCheck2,
  FileText,
  History,
  Image as ImageIcon,
  Link2,
  Mail,
  Maximize2,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
  UserCheck,
  Users,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
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

/* =========================================================
   TYPES
========================================================= */

type OCRField = {
  key: string
  label: string
  value: string
  confidence: number
  status: "high" | "medium" | "low"
}

type OCRSession = {
  file: File
  previewUrl: string
  processing: boolean
  complete: boolean
  fields: OCRField[]
  documentType: string
}

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
  previewUrl?: string
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
    | "OCR_REVIEWED"
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

/* =========================================================
   CONSTANTS
========================================================= */

const CONTACT_STORAGE = "tes_contacts_v3"

const OCR_DEMO_FIELDS: OCRField[] = [
  {
    key: "firstName",
    label: "First Name",
    value: "Tejinder",
    confidence: 98,
    status: "high",
  },
  {
    key: "lastName",
    label: "Last Name",
    value: "Khosa",
    confidence: 99,
    status: "high",
  },
  {
    key: "dlNumber",
    label: "Licence Number",
    value: "AB12345678",
    confidence: 97,
    status: "high",
  },
  {
    key: "province",
    label: "Province / State",
    value: "AB",
    confidence: 99,
    status: "high",
  },
  {
    key: "expiry",
    label: "Expiry Date",
    value: "2028-02-09",
    confidence: 96,
    status: "high",
  },
]

/* =========================================================
   HELPERS
========================================================= */

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

/* =========================================================
   OCR DOCUMENT WORKSPACE
========================================================= */

function OCRDocumentWorkspace({
  session,
  onClose,
  onConfirm,
}: {
  session: OCRSession
  onClose: () => void
  onConfirm: (fields: OCRField[], evidence: Evidence) => void
}) {
  const [fields, setFields] = useState<OCRField[]>(session.fields)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)

  const isPdf = session.file.type === "application/pdf"

  const updateField = (key: string, value: string) => {
    setFields((current) =>
      current.map((field) =>
        field.key === key
          ? {
              ...field,
              value,
              confidence: Math.min(field.confidence + 1, 100),
            }
          : field
      )
    )
  }

  const averageConfidence =
    fields.length > 0
      ? Math.round(
          fields.reduce((sum, field) => sum + field.confidence, 0) /
            fields.length
        )
      : 0

  const handleConfirm = () => {
    const evidence: Evidence = {
      id: makeId("DOC"),
      type: "Driver Licence",
      fileName: session.file.name,
      uploadedAt: now(),
      status: "verified",
      confidence: averageConfidence,
      source: "user_upload",
      previewUrl: session.previewUrl,
    }

    onConfirm(fields, evidence)
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
      {/* TOP BAR */}
      <div className="h-16 border-b bg-background flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Sparkles className="size-4" />
          </div>

          <div className="min-w-0">
            <p className="font-semibold text-sm">
              Document Intelligence Review
            </p>
            <p className="text-xs text-muted-foreground truncate max-w-[450px]">
              {session.file.name}
            </p>
          </div>

          <Badge
            variant="outline"
            className="hidden sm:flex text-[10px] gap-1"
          >
            <ShieldCheck className="size-3" />
            AI Assisted
          </Badge>
        </div>

        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="size-5" />
        </Button>
      </div>

      {/* BODY */}
      <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,1fr)_430px]">
        {/* ORIGINAL DOCUMENT */}
        <div className="min-h-0 flex flex-col border-r bg-muted/20">
          <div className="h-12 border-b bg-background px-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold">Original Document</p>
              <p className="text-[10px] text-muted-foreground">
                Source evidence — never silently altered
              </p>
            </div>

            <div className="flex items-center gap-1">
              {!isPdf && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() =>
                      setZoom((value) => Math.max(0.5, value - 0.1))
                    }
                  >
                    <ZoomOut className="size-4" />
                  </Button>

                  <span className="text-[10px] w-10 text-center">
                    {Math.round(zoom * 100)}%
                  </span>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() =>
                      setZoom((value) => Math.min(2, value + 0.1))
                    }
                  >
                    <ZoomIn className="size-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() =>
                      setRotation((value) => (value + 90) % 360)
                    }
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                </>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title="Full screen preview"
              >
                <Maximize2 className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-6 flex items-center justify-center">
            <div className="bg-background border shadow-sm rounded-lg overflow-hidden">
              {isPdf ? (
                <iframe
                  src={session.previewUrl}
                  title="Uploaded document preview"
                  className="w-[min(70vw,800px)] h-[calc(100vh-150px)] min-h-[500px]"
                />
              ) : (
                <img
                  src={session.previewUrl}
                  alt="Uploaded identity document"
                  className="max-w-[min(70vw,800px)] max-h-[calc(100vh-170px)] object-contain transition-transform"
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  }}
                />
              )}
            </div>
          </div>

          <div className="border-t bg-background p-3">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <FileText className="size-3.5" />
              <span>{session.file.name}</span>
              <span>·</span>
              <span>
                {(session.file.size / 1024 / 1024).toFixed(2)} MB
              </span>
              <span>·</span>
              <span>
                {session.file.type || "Unknown document type"}
              </span>
            </div>
          </div>
        </div>

        {/* AI EXTRACTION */}
        <div className="min-h-0 flex flex-col bg-background">
          <div className="border-b p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">
                  AI Extraction
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Extracted information remains a candidate until reviewed.
                </p>
              </div>

              <div className="text-right">
                <p className="text-lg font-bold">{averageConfidence}%</p>
                <p className="text-[10px] text-muted-foreground">
                  Average confidence
                </p>
              </div>
            </div>

            <div className="mt-4 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${averageConfidence}%` }}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {!session.complete ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="size-7 text-primary animate-pulse" />
                </div>

                <p className="font-medium mt-4">
                  Analyzing document...
                </p>

                <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
                  In production this stage will perform document
                  classification, OCR, field extraction and confidence
                  scoring.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 text-green-600 mt-0.5" />

                    <div>
                      <p className="text-xs font-semibold">
                        Document analyzed
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {fields.length} fields were extracted. Review them
                        against the original document before confirming.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Extracted Fields
                  </Label>

                  <div className="mt-3 space-y-3">
                    {fields.map((field) => (
                      <div
                        key={field.key}
                        className="border rounded-lg p-3"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-xs">
                            {field.label}
                          </Label>

                          <Badge
                            variant="outline"
                            className={`text-[9px] ${
                              field.confidence >= 90
                                ? "border-green-300 text-green-700"
                                : field.confidence >= 80
                                ? "border-amber-300 text-amber-700"
                                : "border-red-300 text-red-700"
                            }`}
                          >
                            {field.confidence}% confidence
                          </Badge>
                        </div>

                        <Input
                          value={field.value}
                          onChange={(e) =>
                            updateField(field.key, e.target.value)
                          }
                          className="h-9 text-sm"
                        />

                        <p className="text-[10px] text-muted-foreground mt-1.5">
                          Candidate value extracted from source document.
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border rounded-lg p-4 bg-amber-50/40 dark:bg-amber-950/10">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="size-4 text-amber-700 mt-0.5" />

                    <div>
                      <p className="text-xs font-semibold">
                        Human confirmation required
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                        AI extraction does not automatically become the
                        authoritative TES record. Confirm the values above
                        against the original document.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {session.complete && (
            <div className="border-t p-4 space-y-2">
              <Button
                className="w-full"
                onClick={handleConfirm}
              >
                <CheckCircle2 className="size-4 mr-2" />
                Confirm Extraction & Attach Evidence
              </Button>

              <Button
                variant="outline"
                className="w-full"
                onClick={onClose}
              >
                Review Later
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   CONTACT PAGE
========================================================= */

export default function ContactsPage() {
  const params = useParams()
  const router = useRouter()

  const companyId = params.id as string

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [company, setCompany] = useState<any>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editingContact, setEditingContact] =
    useState<Contact | null>(null)

  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("active")
  const [verificationFilter, setVerificationFilter] = useState("all")

  const [isPrimary, setIsPrimary] = useState(false)
  const [noteDraft, setNoteDraft] = useState("")

  const [ocrSession, setOcrSession] =
    useState<OCRSession | null>(null)

  /* =======================================================
     LOAD
  ======================================================= */

  useEffect(() => {
    const savedCompanies = JSON.parse(
      localStorage.getItem("tes_companies") || "[]"
    )

    const found = savedCompanies.find(
      (company: any) => company.id === companyId
    )

    setCompany(found || null)

    const savedContacts = JSON.parse(
      localStorage.getItem(CONTACT_STORAGE) || "[]"
    )

    setContacts(
      Array.isArray(savedContacts) ? savedContacts : []
    )

    setLoading(false)
  }, [companyId])

  useEffect(() => {
    if (!loading) {
      localStorage.setItem(
        CONTACT_STORAGE,
        JSON.stringify(contacts)
      )
    }
  }, [contacts, loading])

  /* =======================================================
     DERIVED DATA
  ======================================================= */

  const companyContacts = useMemo(() => {
    return contacts.filter((contact) =>
      contact.relationships.some(
        (relationship) =>
          relationship.companyId === companyId
      )
    )
  }, [contacts, companyId])

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase()

    return companyContacts
      .filter((contact) => {
        if (
          statusFilter === "active" &&
          contact.isArchived
        ) {
          return false
        }

        if (
          statusFilter === "archived" &&
          !contact.isArchived
        ) {
          return false
        }

        if (
          verificationFilter !== "all" &&
          contact.identityStatus !== verificationFilter
        ) {
          return false
        }

        const relationship = contact.relationships.find(
          (item) =>
            item.companyId === companyId &&
            item.status === "active"
        )

        if (
          roleFilter !== "all" &&
          relationship?.role !== roleFilter
        ) {
          return false
        }

        if (!query) return true

        return (
          `${contact.firstName} ${contact.lastName}`
            .toLowerCase()
            .includes(query) ||
          contact.email
            .toLowerCase()
            .includes(query) ||
          contact.phone
            .toLowerCase()
            .includes(query) ||
          contact.globalId
            .toLowerCase()
            .includes(query)
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

  const selectedContact =
    contacts.find((contact) => contact.id === selectedId) ||
    null

  const activeCount = companyContacts.filter(
    (contact) => !contact.isArchived
  ).length

  const primaryCount = companyContacts.filter(
    (contact) =>
      contact.isPrimary && !contact.isArchived
  ).length

  const verifiedCount = companyContacts.filter(
    (contact) =>
      contact.identityStatus === "verified" &&
      !contact.isArchived
  ).length

  const reviewCount = companyContacts.filter(
    (contact) =>
      contact.identityStatus === "review_required" &&
      !contact.isArchived
  ).length

  /* =======================================================
     FORM
  ======================================================= */

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

  const saveContact = (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    const form = new FormData(event.currentTarget)

    const firstName = String(
      form.get("firstName") || ""
    ).trim()

    const lastName = String(
      form.get("lastName") || ""
    ).trim()

    const role = String(form.get("role") || "")
    const email = String(form.get("email") || "").trim()
    const phone = String(form.get("phone") || "").trim()

    if (
      !firstName ||
      !lastName ||
      !role ||
      !email ||
      !phone
    ) {
      return
    }

    let updatedContacts = [...contacts]

    if (editingContact) {
      updatedContacts = updatedContacts.map(
        (contact) => {
          if (contact.id !== editingContact.id) {
            return contact
          }

          const updated: Contact = {
            ...contact,
            firstName,
            lastName,
            role,
            email,
            phone,
            isPrimary,
            updatedAt: now(),
          }

          return appendEvent(
            updated,
            "CONTACT_UPDATED",
            `Contact profile updated for ${firstName} ${lastName}.`
          )
        }
      )

      if (isPrimary) {
        updatedContacts = updatedContacts.map(
          (contact) => {
            if (
              contact.id === editingContact.id ||
              !contact.isPrimary
            ) {
              return contact
            }

            const belongsToCompany =
              contact.relationships.some(
                (relationship) =>
                  relationship.companyId ===
                    companyId &&
                  relationship.status === "active"
              )

            if (!belongsToCompany) return contact

            return appendEvent(
              {
                ...contact,
                isPrimary: false,
              },
              "PRIMARY_CHANGED",
              `Primary contact designation transferred to ${firstName} ${lastName}.`
            )
          }
        )
      }
    } else {
      const relationship: Relationship = {
        id: makeId("REL"),
        companyId,
        companyName: company.name,
        role,
        status: "active",
        startDate: new Date()
          .toISOString()
          .slice(0, 10),
        source: "manual",
      }

      const newContact: Contact = {
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
        newContact,
        "CONTACT_CREATED",
        `Contact created and linked to ${company.name}.`
      )

      updatedContacts = [
        created,
        ...updatedContacts,
      ]

      if (isPrimary) {
        updatedContacts = updatedContacts.map(
          (contact) => {
            if (contact.id === created.id) {
              return contact
            }

            const belongsToCompany =
              contact.relationships.some(
                (relationship) =>
                  relationship.companyId ===
                    companyId &&
                  relationship.status === "active"
              )

            if (
              !belongsToCompany ||
              !contact.isPrimary
            ) {
              return contact
            }

            return appendEvent(
              {
                ...contact,
                isPrimary: false,
              },
              "PRIMARY_CHANGED",
              `Primary contact designation transferred to ${firstName} ${lastName}.`
            )
          }
        )
      }

      setSelectedId(created.id)
      setNoteDraft("")
    }

    setContacts(updatedContacts)
    closeForm()
  }

  /* =======================================================
     ARCHIVE
  ======================================================= */

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

  /* =======================================================
     NOTES
  ======================================================= */

  const saveNote = () => {
    if (!selectedContact || !noteDraft.trim()) {
      return
    }

    setContacts((current) =>
      current.map((contact) => {
        if (contact.id !== selectedContact.id) {
          return contact
        }

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

  /* =======================================================
     OCR
  ======================================================= */

  const openOCR = () => {
    fileInputRef.current?.click()
  }

  const handleOCRFile = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0]

    if (!file) return

    const supportedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]

    if (!supportedTypes.includes(file.type)) {
      window.alert(
        "Please upload a PDF, JPG, PNG or WEBP document."
      )

      event.target.value = ""
      return
    }

    const previewUrl = URL.createObjectURL(file)

    setOcrSession({
      file,
      previewUrl,
      processing: true,
      complete: false,
      fields: [],
      documentType: "Government Identity Document",
    })

    /*
      DEMO OCR PROCESSING

      This deliberately simulates the production workflow.

      Production replacement:

      upload
        ↓
      secure document storage
        ↓
      OCR / document classification
        ↓
      extraction
        ↓
      confidence scoring
        ↓
      conflict detection
        ↓
      human review
    */

    setTimeout(() => {
      setOcrSession((current) => {
        if (!current) return null

        return {
          ...current,
          processing: false,
          complete: true,
          fields: OCR_DEMO_FIELDS,
        }
      })
    }, 1800)

    event.target.value = ""
  }

  const confirmOCR = (
    fields: OCRField[],
    evidence: Evidence
  ) => {
    if (!company) return

    const getValue = (key: string) =>
      fields.find((field) => field.key === key)?.value ||
      ""

    const firstName = getValue("firstName")
    const lastName = getValue("lastName")

    if (!firstName || !lastName) {
      window.alert(
        "The extracted identity does not contain a complete name."
      )

      return
    }

    const confidence =
      Math.round(
        fields.reduce(
          (sum, field) => sum + field.confidence,
          0
        ) / fields.length
      )

    const existingContact =
      editingContact ||
      contacts.find(
        (contact) =>
          contact.firstName.toLowerCase() ===
            firstName.toLowerCase() &&
          contact.lastName.toLowerCase() ===
            lastName.toLowerCase()
      )

    if (existingContact) {
      const updated = appendEvent(
        {
          ...existingContact,
          firstName,
          lastName,
          identityStatus:
            confidence >= 90
              ? "verified"
              : "review_required",
          identityConfidence: confidence,
          evidence: [
            evidence,
            ...existingContact.evidence,
          ],
        },
        "OCR_REVIEWED",
        `Identity document reviewed. OCR confidence ${confidence}%.`
      )

      setContacts((current) =>
        current.map((contact) =>
          contact.id === updated.id
            ? updated
            : contact
        )
      )

      setSelectedId(updated.id)
    } else {
      const relationship: Relationship = {
        id: makeId("REL"),
        companyId,
        companyName: company.name,
        role: "Other",
        status: "active",
        startDate: new Date()
          .toISOString()
          .slice(0, 10),
        source: "document",
      }

      const newContact: Contact = {
        id: makeId("CNT"),
        globalId: makeId("USR"),
        firstName,
        lastName,
        role: "Other",
        email: "",
        phone: "",
        isPrimary: false,
        isArchived: false,
        createdAt: now(),
        updatedAt: now(),
        notes: "",
        identityStatus:
          confidence >= 90
            ? "verified"
            : "review_required",
        identityConfidence: confidence,
        relationships: [relationship],
        evidence: [evidence],
        events: [],
      }

      const created = appendEvent(
        newContact,
        "DOCUMENT_ATTACHED",
        `Contact created from reviewed identity document. OCR confidence ${confidence}%.`
      )

      setContacts((current) => [
        created,
        ...current,
      ])

      setSelectedId(created.id)
    }

    if (ocrSession?.previewUrl) {
      URL.revokeObjectURL(ocrSession.previewUrl)
    }

    setOcrSession(null)
  }

  /* =======================================================
     LOADING
  ======================================================= */

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
        <p className="font-medium">
          Company not found
        </p>
      </div>
    )
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <div className="max-w-[1500px] space-y-6 pb-12">
        {/* HEADER */}
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                router.push(
                  `/companies/${company.id}/profile`
                )
              }
            >
              <ArrowLeft className="size-4" />
            </Button>

            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">
                  Contacts & Relationships
                </h1>

                <Badge
                  variant="outline"
                  className="font-mono text-[10px]"
                >
                  {company.id}
                </Badge>
              </div>

              <p className="text-sm text-muted-foreground mt-1">
                {company.name} · Personnel identity and
                relationship workspace
              </p>
            </div>

            <Button onClick={openCreate}>
              <Plus className="size-4 mr-2" />
              Add Contact
            </Button>
          </div>

          {/* OCR ACTION */}
          <div className="rounded-xl border bg-primary/[0.025] p-4">
            <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
              <div className="flex items-start gap-3">
                <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Sparkles className="size-5" />
                </div>

                <div>
                  <p className="text-sm font-semibold">
                    Document-assisted contact creation
                  </p>

                  <p className="text-xs text-muted-foreground mt-1 max-w-[700px]">
                    Upload an identity document to test the
                    TES document workflow: original document
                    preview → OCR extraction → confidence →
                    human review → evidence attachment.
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={openOCR}
                className="shrink-0"
              >
            <div className="flex items-center gap-2">
            <div className="relative size-4 flex items-center justify-center">
            {/* Scan frame */}
            <span className="absolute inset-0">
            <span className="absolute left-0 top-0 h-1.5 w-1.5 border-l-[1.5px] border-t-[1.5px] border-primary rounded-tl-[2px]" />
            <span className="absolute right-0 top-0 h-1.5 w-1.5 border-r-[1.5px] border-t-[1.5px] border-primary rounded-tr-[2px]" />
            <span className="absolute left-0 bottom-0 h-1.5 w-1.5 border-l-[1.5px] border-b-[1.5px] border-primary rounded-bl-[2px]" />
            <span className="absolute right-0 bottom-0 h-1.5 w-1.5 border-r-[1.5px] border-b-[1.5px] border-primary rounded-br-[2px]" />
            </span>

            {/* Document */}
            <FileText className="size-2.5 text-primary stroke-[1.8]" />
            </div>

            <span>Upload ID for OCR</span>
            </div>
              </Button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={handleOCRFile}
            />
          </div>

          {/* STATUS STRIP */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Users className="size-4" />
                  Active Contacts
                </div>

                <p className="text-2xl font-semibold mt-1">
                  {activeCount}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <UserCheck className="size-4" />
                  Primary
                </div>

                <p className="text-2xl font-semibold mt-1">
                  {primaryCount}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <ShieldCheck className="size-4" />
                  Verified
                </div>

                <p className="text-2xl font-semibold mt-1">
                  {verifiedCount}
                </p>
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

                <p className="text-2xl font-semibold mt-1">
                  {reviewCount}
                </p>
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
                    Active and historical personnel
                    relationships for this company.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />

                    <Input
                      value={search}
                      onChange={(e) =>
                        setSearch(e.target.value)
                      }
                      placeholder="Search personnel..."
                      className="pl-9 w-[220px]"
                    />
                  </div>

                  <Select
                    value={roleFilter}
                    onValueChange={setRoleFilter}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="all">
                        All roles
                      </SelectItem>
                      <SelectItem value="Owner">
                        Owner
                      </SelectItem>
                      <SelectItem value="Safety Manager">
                        Safety Manager
                      </SelectItem>
                      <SelectItem value="Dispatcher">
                        Dispatcher
                      </SelectItem>
                      <SelectItem value="Billing">
                        Billing
                      </SelectItem>
                      <SelectItem value="Consultant">
                        Consultant
                      </SelectItem>
                      <SelectItem value="Other">
                        Other
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={verificationFilter}
                    onValueChange={
                      setVerificationFilter
                    }
                  >
                    <SelectTrigger className="w-[155px]">
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="all">
                        All identity states
                      </SelectItem>
                      <SelectItem value="verified">
                        Verified
                      </SelectItem>
                      <SelectItem value="unverified">
                        Unverified
                      </SelectItem>
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
                      <SelectItem value="active">
                        Active
                      </SelectItem>
                      <SelectItem value="archived">
                        Archived
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {/* MANUAL FORM */}
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
                        Manual entries remain unverified until
                        appropriate evidence is reviewed.
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
                        defaultValue={
                          editingContact?.firstName || ""
                        }
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Last Name *</Label>
                      <Input
                        name="lastName"
                        defaultValue={
                          editingContact?.lastName || ""
                        }
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Role / Relationship *</Label>

                      <Select
                        defaultValue={
                          editingContact?.relationships.find(
                            (relationship) =>
                              relationship.companyId ===
                              companyId
                          )?.role || ""
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select relationship" />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectItem value="Owner">
                            Owner / President
                          </SelectItem>
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
                          <SelectItem value="Other">
                            Other
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Kept as a hidden fallback for prototype form handling */}
                      <input
                        type="hidden"
                        name="role"
                        value={
                          editingContact?.role ||
                          "Other"
                        }
                        readOnly
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Phone *</Label>

                      <Input
                        name="phone"
                        defaultValue={
                          editingContact?.phone || ""
                        }
                        required
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label>Email *</Label>

                      <Input
                        name="email"
                        type="email"
                        defaultValue={
                          editingContact?.email || ""
                        }
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
                          Changing the primary designation
                          creates a historical event.
                        </p>
                      </div>

                      <Checkbox
                        checked={isPrimary}
                        onCheckedChange={(checked) =>
                          setIsPrimary(
                            checked === true
                          )
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
                      {editingContact
                        ? "Save Changes"
                        : "Create Contact"}
                    </Button>
                  </div>
                </form>
              )}

              {/* CONTACT LIST */}
              {filteredContacts.length === 0 ? (
                <div className="p-16 text-center">
                  <div className="mx-auto size-12 rounded-full bg-muted flex items-center justify-center">
                    <Users className="size-6 text-muted-foreground" />
                  </div>

                  <h3 className="font-medium mt-4">
                    No contacts in this view
                  </h3>

                  <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1">
                    No matching contact records were found.
                    Historical records are preserved through
                    archive rather than deletion.
                  </p>

                  {statusFilter === "active" && (
                    <Button
                      className="mt-5"
                      onClick={openCreate}
                    >
                      <Plus className="size-4 mr-2" />
                      Add First Contact
                    </Button>
                  )}
                </div>
              ) : (
                <div className="divide-y">
                  {filteredContacts.map((contact) => {
                    const relationship =
                      contact.relationships.find(
                        (item) =>
                          item.companyId ===
                            companyId &&
                          item.status === "active"
                      )

                    const selected =
                      contact.id === selectedId

                    return (
                      <div
                        key={contact.id}
                        onClick={() => {
                          setSelectedId(contact.id)
                          setNoteDraft(
                            contact.notes || ""
                          )
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
                                  {contact.firstName}{" "}
                                  {contact.lastName}
                                </span>

                                {contact.isPrimary &&
                                  !contact.isArchived && (
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
                                  {relationship?.role ||
                                    contact.role}
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

                              <span className="truncate">
                                {contact.email ||
                                  "No email recorded"}
                              </span>
                            </div>

                            <span className="text-muted-foreground">
                              {contact.phone ||
                                "No phone recorded"}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 md:w-[180px] md:justify-end">
                            {contact.identityStatus ===
                              "verified" && (
                              <Badge
                                variant="outline"
                                className="text-[10px] gap-1"
                              >
                                <CheckCircle2 className="size-3" />
                                Verified
                              </Badge>
                            )}

                            {contact.identityStatus ===
                              "review_required" && (
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
                                title="Archive contact"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  archiveContact(
                                    contact
                                  )
                                }}
                              >
                                <Archive className="size-4" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Restore contact"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  restoreContact(
                                    contact
                                  )
                                }}
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
                    View identity state, company
                    relationships, evidence, notes and
                    event history.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="overflow-hidden">
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

                        {selectedContact.identityStatus ===
                          "verified" && (
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
                  {/* SUMMARY */}
                  <div className="p-4 border-b bg-muted/10">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          Email
                        </p>

                        <p className="text-xs mt-1 truncate">
                          {selectedContact.email ||
                            "Not recorded"}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          Phone
                        </p>

                        <p className="text-xs mt-1">
                          {selectedContact.phone ||
                            "Not recorded"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 space-y-5">
                    {/* IDENTITY */}
                    <section>
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Identity State
                        </Label>

                        {selectedContact.identityConfidence !==
                          undefined && (
                          <span className="text-xs font-medium">
                            {
                              selectedContact.identityConfidence
                            }
                            % confidence
                          </span>
                        )}
                      </div>

                      <div className="mt-3 p-3 rounded-lg border bg-muted/20">
                        {selectedContact.identityStatus ===
                          "verified" && (
                          <div className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="size-4 text-green-600" />
                            Identity verified
                          </div>
                        )}

                        {selectedContact.identityStatus ===
                          "unverified" && (
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

                    {/* RELATIONSHIPS */}
                    <section>
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Company Relationships
                        </Label>

                        <Link2 className="size-3.5 text-muted-foreground" />
                      </div>

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
                                      {
                                        relationship.companyName
                                      }
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

                                <p className="text-[10px] text-muted-foreground mt-2">
                                  Relationship started{" "}
                                  {
                                    relationship.startDate
                                  }
                                </p>
                              </div>
                            </Link>
                          )
                        )}
                      </div>
                    </section>

                    {/* EVIDENCE */}
                    <section>
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Identity Evidence
                          </Label>

                          <p className="text-[10px] text-muted-foreground mt-1">
                            Source documents supporting identity.
                          </p>
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={openOCR}
                        >
                <div className="relative size-3.5 flex items-center justify-center">
                <span className="absolute inset-0">
                <span className="absolute left-0 top-0 h-1 w-1 border-l-[1.5px] border-t-[1.5px] border-primary rounded-tl-[1px]" />
                <span className="absolute right-0 top-0 h-1 w-1 border-r-[1.5px] border-t-[1.5px] border-primary rounded-tr-[1px]" />
                <span className="absolute left-0 bottom-0 h-1 w-1 border-l-[1.5px] border-b-[1.5px] border-primary rounded-bl-[1px]" />
                <span className="absolute right-0 bottom-0 h-1 w-1 border-r-[1.5px] border-b-[1.5px] border-primary rounded-br-[1px]" />
                </span>

                <FileText className="size-2 text-primary stroke-[1.8]" />
                </div>
                        </Button>
                      </div>

                      <div className="mt-3 space-y-2">
                        {selectedContact.evidence.length ===
                        0 ? (
                          <div className="border border-dashed rounded-lg p-6 text-center">
                            <FileText className="size-6 mx-auto text-muted-foreground/40" />

                            <p className="text-xs font-medium mt-2">
                              No evidence attached
                            </p>

                            <p className="text-[10px] text-muted-foreground mt-1">
                              Upload a source document to
                              begin identity verification.
                            </p>
                          </div>
                        ) : (
                          selectedContact.evidence.map(
                            (document) => (
                              <div
                                key={document.id}
                                className="border rounded-lg p-3"
                              >
                                <div className="flex items-start gap-3">
                                  <FileCheck2 className="size-4 text-primary mt-0.5" />

                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium truncate">
                                      {
                                        document.fileName
                                      }
                                    </p>

                                    <p className="text-[10px] text-muted-foreground mt-1">
                                      {document.type} ·{" "}
                                      {document.confidence
                                        ? `${document.confidence}% confidence`
                                        : "No confidence score"}
                                    </p>
                                  </div>

                                  <Badge
                                    variant="outline"
                                    className="text-[9px]"
                                  >
                                    {document.status ===
                                    "review_required"
                                      ? "Review"
                                      : document.status}
                                  </Badge>
                                </div>
                              </div>
                            )
                          )
                        )}
                      </div>
                    </section>

                    {/* NOTES */}
                    <section>
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Internal Notes
                      </Label>

                      <Textarea
                        value={noteDraft}
                        onChange={(event) =>
                          setNoteDraft(
                            event.target.value
                          )
                        }
                        placeholder="Add an operational note..."
                        className="mt-2 min-h-[130px] resize-none"
                      />

                      <Button
                        className="w-full mt-2"
                        size="sm"
                        onClick={saveNote}
                        disabled={!noteDraft.trim()}
                      >
                        Save Note
                      </Button>
                    </section>

                    {/* EVENT HISTORY */}
                    <section>
                      <div className="flex items-center gap-2">
                        <History className="size-4 text-primary" />

                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Event History
                        </Label>
                      </div>

                      <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto">
                        {selectedContact.events.length ===
                        0 ? (
                          <p className="text-xs text-muted-foreground text-center py-6">
                            No events recorded.
                          </p>
                        ) : (
                          selectedContact.events.map(
                            (event) => (
                              <div
                                key={event.id}
                                className="border rounded-lg p-3"
                              >
                                <p className="text-[10px] font-semibold uppercase">
                                  {event.type.replaceAll(
                                    "_",
                                    " "
                                  )}
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
                            )
                          )
                        )}
                      </div>
                    </section>
                  </div>

                  {/* ARCHIVE */}
                  <div className="border-t p-3 bg-muted/10">
                    {selectedContact.isArchived ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() =>
                          restoreContact(
                            selectedContact
                          )
                        }
                      >
                        <ArchiveRestore className="size-4 mr-2" />
                        Restore Contact
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full text-destructive hover:text-destructive"
                        onClick={() =>
                          archiveContact(
                            selectedContact
                          )
                        }
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

      {/* OCR WORKSPACE */}
      {ocrSession && (
        <OCRDocumentWorkspace
          session={ocrSession}
          onClose={() => {
            if (ocrSession.previewUrl) {
              URL.revokeObjectURL(
                ocrSession.previewUrl
              )
            }

            setOcrSession(null)
          }}
          onConfirm={confirmOCR}
        />
      )}
    </>
  )
}
