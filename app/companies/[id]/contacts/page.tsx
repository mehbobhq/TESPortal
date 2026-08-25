"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Building2,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileCheck2,
  FileText,
  Fullscreen,
  History,
  Mail,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
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

type IdentityStatus =
  | "unverified"
  | "verified"
  | "review_required"

type OCRStatus =
  | "idle"
  | "processing"
  | "complete"
  | "failed"

type OCRFieldKey =
  | "firstName"
  | "lastName"
  | "dob"
  | "dlNumber"
  | "dlState"
  | "dlExpiry"
  | "dlIssueDate"
  | "dlClass"
  | "dlRestrictions"

type OCRField = {
  key: OCRFieldKey
  label: string
  value: string
  confidence: number
  required: boolean
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
  type: "Driver Licence" | "Government ID" | "Other"
  fileName: string
  fileType: string
  uploadedAt: string
  confidence?: number
  status:
    | "uploaded"
    | "review_required"
    | "verified"
    | "rejected"
  source: "camera" | "device"
  dataUrl?: string
}

type ContactEvent = {
  id: string
  type:
    | "CONTACT_CREATED"
    | "CONTACT_UPDATED"
    | "CONTACT_ARCHIVED"
    | "CONTACT_RESTORED"
    | "PRIMARY_CHANGED"
    | "NOTE_ADDED"
    | "DOCUMENT_ATTACHED"
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

  dob: string

  dlNumber: string
  dlState: string
  dlExpiry: string
  dlIssueDate: string
  dlClass: string
  dlRestrictions: string

  email: string
  phone: string

  role: string
  isPrimary: boolean

  isArchived: boolean

  createdAt: string
  updatedAt: string

  notes: string

  identityStatus: IdentityStatus
  identityConfidence?: number

  relationships: Relationship[]
  evidence: Evidence[]
  events: ContactEvent[]
}

type ContactDraft = {
  firstName: string
  lastName: string
  dob: string

  dlNumber: string
  dlState: string
  dlExpiry: string
  dlIssueDate: string
  dlClass: string
  dlRestrictions: string

  email: string
  phone: string

  role: string
  isPrimary: boolean
}

type DocumentSource = "camera" | "device"

type OCRSession = {
  file: File
  dataUrl: string
  source: DocumentSource
  status: OCRStatus
  fields: OCRField[]
  draft: ContactDraft
  mode: "ocr_create" | "manual_attachment"
}

/* =========================================================
   CONSTANTS
========================================================= */

const CONTACT_STORAGE = "tes_contacts_v5"

const OCR_REQUIRED_THRESHOLD = 85

const EMPTY_DRAFT: ContactDraft = {
  firstName: "",
  lastName: "",
  dob: "",

  dlNumber: "",
  dlState: "",
  dlExpiry: "",
  dlIssueDate: "",
  dlClass: "",
  dlRestrictions: "",

  email: "",
  phone: "",

  role: "",
  isPrimary: false,
}

/*
  Prototype OCR result.

  Replace ONLY the extraction function later.

  The rest of this page should remain the same when the real
  OCR service is connected.
*/
const OCR_DEMO_FIELDS: OCRField[] = [
  {
    key: "firstName",
    label: "First Name",
    value: "Parwinder",
    confidence: 98,
    required: true,
  },
  {
    key: "lastName",
    label: "Last Name",
    value: "Singh",
    confidence: 99,
    required: true,
  },
  {
    key: "dob",
    label: "Date of Birth",
    value: "2004-09-02",
    confidence: 97,
    required: true,
  },
  {
    key: "dlNumber",
    label: "Driver Licence #",
    value: "1017-29721",
    confidence: 96,
    required: true,
  },
  {
    key: "dlState",
    label: "Issuing Province / State",
    value: "AB",
    confidence: 99,
    required: true,
  },
  {
    key: "dlExpiry",
    label: "Expiry Date",
    value: "2026-09-02",
    confidence: 98,
    required: true,
  },
  {
    key: "dlIssueDate",
    label: "Issue Date",
    value: "2026-05-17",
    confidence: 93,
    required: false,
  },
  {
    key: "dlClass",
    label: "Licence Class",
    value: "",
    confidence: 0,
    required: false,
  },
  {
    key: "dlRestrictions",
    label: "Restrictions",
    value: "",
    confidence: 0,
    required: false,
  },
]

/* =========================================================
   HELPERS
========================================================= */

function makeId(prefix: string) {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.floor(
    Math.random() * 10000
  )}`
}

function now() {
  return new Date().toISOString()
}

function appendEvent(
  contact: Contact,
  type: ContactEvent["type"],
  description: string
): Contact {
  return {
    ...contact,
    updatedAt: now(),
    events: [
      {
        id: makeId("EVT"),
        type,
        timestamp: now(),
        actor: "Current User",
        description,
      },
      ...(contact.events || []),
    ],
  }
}

function averageConfidence(fields: OCRField[]) {
  const usable = fields.filter(
    (field) => field.confidence > 0
  )

  if (!usable.length) return 0

  return Math.round(
    usable.reduce(
      (sum, field) => sum + field.confidence,
      0
    ) / usable.length
  )
}

function hasOCRConfidenceFailure(fields: OCRField[]) {
  return fields.some(
    (field) =>
      field.required &&
      (
        !field.value.trim() ||
        field.confidence < OCR_REQUIRED_THRESHOLD
      )
  )
}

function getOCRField(
  fields: OCRField[],
  key: OCRFieldKey
) {
  return (
    fields.find((field) => field.key === key)
      ?.value || ""
  )
}

function readFileAsDataUrl(
  file: File
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () =>
      resolve(String(reader.result || ""))

    reader.onerror = reject

    reader.readAsDataURL(file)
  })
}

/* =========================================================
   STANDARD TES OCR ICON
========================================================= */

function ScanDocumentIcon({
  size = 16,
}: {
  size?: number
}) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
      }}
    >
      <span className="absolute inset-0">
        <span className="absolute left-0 top-0 h-[35%] w-[35%] rounded-tl-[2px] border-l-[1.5px] border-t-[1.5px] border-current" />
        <span className="absolute right-0 top-0 h-[35%] w-[35%] rounded-tr-[2px] border-r-[1.5px] border-t-[1.5px] border-current" />
        <span className="absolute bottom-0 left-0 h-[35%] w-[35%] rounded-bl-[2px] border-b-[1.5px] border-l-[1.5px] border-current" />
        <span className="absolute bottom-0 right-0 h-[35%] w-[35%] rounded-br-[2px] border-b-[1.5px] border-r-[1.5px] border-current" />
      </span>

      <FileText
        style={{
          width: size * 0.55,
          height: size * 0.55,
          strokeWidth: 1.8,
        }}
      />
    </span>
  )
}

/* =========================================================
   DOCUMENT SOURCE PICKER
========================================================= */

function DocumentSourcePicker({
  title,
  onCamera,
  onDevice,
  onCancel,
}: {
  title: string
  onCamera: () => void
  onDevice: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-lg shadow-2xl">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ScanDocumentIcon size={18} />
                {title}
              </CardTitle>

              <CardDescription className="mt-1">
                Choose how you want to provide the identity document.
              </CardDescription>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCancel}
            >
              <X className="size-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCamera}
            className="group rounded-xl border p-5 text-left transition-all hover:border-primary/40 hover:bg-primary/[0.035]"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Camera className="size-5" />
            </div>

            <p className="mt-4 text-sm font-semibold">
              Take Photo
            </p>

            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Capture the identity document using the device camera.
            </p>
          </button>

          <button
            type="button"
            onClick={onDevice}
            className="group rounded-xl border p-5 text-left transition-all hover:border-primary/40 hover:bg-primary/[0.035]"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Upload className="size-5" />
            </div>

            <p className="mt-4 text-sm font-semibold">
              Upload from Device
            </p>

            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Choose an existing image or PDF from device storage.
            </p>
          </button>
        </CardContent>
      </Card>
    </div>
  )
}

/* =========================================================
   DOCUMENT VIEWER
========================================================= */

function DocumentViewer({
  session,
  onReplace,
}: {
  session: OCRSession
  onReplace: () => void
}) {
  const viewerRef = useRef<HTMLDivElement | null>(
    null
  )

  const dragRef = useRef({
    active: false,
    x: 0,
    y: 0,
  })

  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)

  const [pan, setPan] = useState({
    x: 0,
    y: 0,
  })

  const isPdf =
    session.file.type === "application/pdf"

  const fitDocument = () => {
    setZoom(1)
    setPan({
      x: 0,
      y: 0,
    })
  }

  const zoomIn = () => {
    setZoom((current) =>
      Math.min(current + 0.25, 4)
    )
  }

  const zoomOut = () => {
    setZoom((current) => {
      const next = Math.max(
        current - 0.25,
        0.5
      )

      if (next <= 1) {
        setPan({
          x: 0,
          y: 0,
        })
      }

      return next
    })
  }

  const handlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    dragRef.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
    }

    event.currentTarget.setPointerCapture(
      event.pointerId
    )
  }

  const handlePointerMove = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!dragRef.current.active) return

    const deltaX =
      event.clientX - dragRef.current.x

    const deltaY =
      event.clientY - dragRef.current.y

    dragRef.current.x = event.clientX
    dragRef.current.y = event.clientY

    setPan((current) => ({
      x: current.x + deltaX,
      y: current.y + deltaY,
    }))
  }

  const handlePointerUp = () => {
    dragRef.current.active = false
  }

  const enterFullScreen = async () => {
    const element = viewerRef.current

    if (!element) return

    try {
      if (!document.fullscreenElement) {
        await element.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch (error) {
      console.error(
        "Unable to enter fullscreen:",
        error
      )
    }
  }

  return (
    <div
      ref={viewerRef}
      className="flex h-full min-h-0 flex-col bg-muted/15 fullscreen:bg-background"
    >
      {/* TOOLBAR */}
      <div className="flex min-h-12 items-center justify-between gap-3 border-b bg-background px-4">
        <div>
          <p className="text-xs font-semibold">
            Original Document
          </p>

          <p className="text-[10px] text-muted-foreground">
            Source evidence — never silently altered
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={fitDocument}
          >
            Fit
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={zoomOut}
          >
            <ZoomOut className="size-4" />
          </Button>

          <span className="w-12 text-center text-[10px] font-medium">
            {Math.round(zoom * 100)}%
          </span>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={zoomIn}
          >
            <ZoomIn className="size-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() =>
              setRotation(
                (current) =>
                  (current + 90) % 360
              )
            }
          >
            <RotateCcw className="size-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={enterFullScreen}
            title="Full screen"
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* DOCUMENT CANVAS */}
      <div
        className="
          relative
          flex-1
          min-h-[420px]
          overflow-hidden
          bg-muted/20
          cursor-grab
          active:cursor-grabbing
          select-none
        "
        style={{
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="absolute inset-0 flex items-center justify-center p-4 lg:p-6">
          <div
            className="flex max-h-full max-w-full items-center justify-center transition-transform duration-75"
            style={{
              transform: `
                translate(${pan.x}px, ${pan.y}px)
                scale(${zoom})
                rotate(${rotation}deg)
              `,
              transformOrigin: "center center",
            }}
          >
            {isPdf ? (
              <iframe
                src={session.dataUrl}
                title="Uploaded identity document"
                className="
                  h-[min(75vh,850px)]
                  w-[min(75vw,900px)]
                  rounded-lg
                  border
                  bg-background
                  shadow-sm
                  pointer-events-none
                "
              />
            ) : (
              <img
                src={session.dataUrl}
                alt="Uploaded identity document"
                draggable={false}
                className="
                  max-h-[calc(100vh-185px)]
                  max-w-[calc(100vw-500px)]
                  object-contain
                  rounded-md
                  bg-background
                  shadow-sm
                "
              />
            )}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-2">
        <div className="min-w-0">
          <p className="max-w-[450px] truncate text-[10px] text-muted-foreground">
            {session.file.name}
            {" · "}
            {(session.file.size / 1024 / 1024).toFixed(
              2
            )}{" "}
            MB
            {" · "}
            {session.source === "camera"
              ? "Camera"
              : "Device Upload"}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={onReplace}
        >
          <RotateCcw className="mr-1.5 size-3.5" />

          {session.source === "camera"
            ? "Retake / Replace"
            : "Replace Document"}
        </Button>
      </div>
    </div>
  )
}

/* =========================================================
   CONTACT FIELDS
========================================================= */

function ContactFields({
  draft,
  onChange,
  ocrFields,
  showConfidence = false,
}: {
  draft: ContactDraft
  onChange: <K extends keyof ContactDraft>(
    key: K,
    value: ContactDraft[K]
  ) => void
  ocrFields?: OCRField[]
  showConfidence?: boolean
}) {
  const confidence = (
    key: OCRFieldKey
  ) =>
    ocrFields?.find(
      (field) => field.key === key
    )

  const confidenceBadge = (
    key: OCRFieldKey
  ) => {
    if (!showConfidence) return null

    const field = confidence(key)

    if (!field || field.confidence <= 0)
      return null

    const good =
      field.confidence >= OCR_REQUIRED_THRESHOLD

    return (
      <Badge
        variant="outline"
        className={`text-[9px] ${
          good
            ? "border-emerald-300 text-emerald-700"
            : "border-red-300 text-red-700"
        }`}
      >
        {field.confidence}%
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      {/* IDENTITY */}
      <div>
        <div className="mb-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Identity
          </p>

          <p className="mt-1 text-[11px] text-muted-foreground">
            Document-derived identity information.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>First Name *</Label>
              {confidenceBadge("firstName")}
            </div>

            <Input
              value={draft.firstName}
              onChange={(event) =>
                onChange(
                  "firstName",
                  event.target.value
                )
              }
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Last Name *</Label>
              {confidenceBadge("lastName")}
            </div>

            <Input
              value={draft.lastName}
              onChange={(event) =>
                onChange(
                  "lastName",
                  event.target.value
                )
              }
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Date of Birth</Label>
              {confidenceBadge("dob")}
            </div>

            <Input
              type="date"
              value={draft.dob}
              onChange={(event) =>
                onChange(
                  "dob",
                  event.target.value
                )
              }
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Driver Licence #</Label>
              {confidenceBadge("dlNumber")}
            </div>

            <Input
              value={draft.dlNumber}
              onChange={(event) =>
                onChange(
                  "dlNumber",
                  event.target.value
                )
              }
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>
                Issuing Province / State
              </Label>

              {confidenceBadge("dlState")}
            </div>

            <Input
              value={draft.dlState}
              onChange={(event) =>
                onChange(
                  "dlState",
                  event.target.value.toUpperCase()
                )
              }
              maxLength={3}
              placeholder="AB"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Expiry Date</Label>
              {confidenceBadge("dlExpiry")}
            </div>

            <Input
              type="date"
              value={draft.dlExpiry}
              onChange={(event) =>
                onChange(
                  "dlExpiry",
                  event.target.value
                )
              }
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Issue Date</Label>
              {confidenceBadge("dlIssueDate")}
            </div>

            <Input
              type="date"
              value={draft.dlIssueDate}
              onChange={(event) =>
                onChange(
                  "dlIssueDate",
                  event.target.value
                )
              }
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Licence Class</Label>
              {confidenceBadge("dlClass")}
            </div>

            <Input
              value={draft.dlClass}
              onChange={(event) =>
                onChange(
                  "dlClass",
                  event.target.value
                )
              }
              placeholder="e.g. Class 1"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Restrictions</Label>
              {confidenceBadge(
                "dlRestrictions"
              )}
            </div>

            <Input
              value={draft.dlRestrictions}
              onChange={(event) =>
                onChange(
                  "dlRestrictions",
                  event.target.value
                )
              }
              placeholder="None / conditions / endorsements"
            />
          </div>
        </div>
      </div>

      {/* CONTACT + RELATIONSHIP */}
      <div className="border-t pt-5">
        <div className="mb-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Contact & Relationship
          </p>

          <p className="mt-1 text-[11px] text-muted-foreground">
            Information not normally available from the identity document.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Email *</Label>

            <Input
              type="email"
              value={draft.email}
              onChange={(event) =>
                onChange(
                  "email",
                  event.target.value
                )
              }
              placeholder="contact@example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Phone *</Label>

            <Input
              type="tel"
              value={draft.phone}
              onChange={(event) =>
                onChange(
                  "phone",
                  event.target.value
                )
              }
              placeholder="+1 ..."
              required
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>Role / Relationship *</Label>

            <Select
              value={draft.role || undefined}
              onValueChange={(value) =>
                onChange("role", value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select relationship" />
              </SelectTrigger>

              <SelectContent className="z-[100]">
                <SelectItem value="Owner">
                  Owner / President
                </SelectItem>

                <SelectItem value="Director">
                  Director
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

                <SelectItem value="Driver">
                  Driver
                </SelectItem>

                <SelectItem value="Consultant">
                  Third-Party Consultant
                </SelectItem>

                <SelectItem value="Other">
                  Other
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">
                  Primary Contact
                </p>

                <p className="mt-1 text-xs text-muted-foreground">
                  Primary contact is pinned above all other active contacts for this company.
                </p>
              </div>

              <Checkbox
                checked={draft.isPrimary}
                onCheckedChange={(checked) =>
                  onChange(
                    "isPrimary",
                    checked === true
                  )
                }
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   OCR CONTACT WORKSPACE
========================================================= */

function OCRContactWorkspace({
  session,
  onClose,
  onReplace,
  onSave,
}: {
  session: OCRSession
  onClose: () => void
  onReplace: () => void
  onSave: (
    session: OCRSession
  ) => void
}) {
  const [workingSession, setWorkingSession] =
    useState(session)

  useEffect(() => {
    setWorkingSession(session)
  }, [session])

  const fields = workingSession.fields

  const confidence =
    averageConfidence(fields)

  const confidenceFailed =
    hasOCRConfidenceFailure(fields)

  const complete =
    workingSession.status === "complete"

  const requiredContactFieldsComplete =
    Boolean(
      workingSession.draft.firstName.trim() &&
      workingSession.draft.lastName.trim() &&
      workingSession.draft.email.trim() &&
      workingSession.draft.phone.trim() &&
      workingSession.draft.role.trim()
    )

  const canSave =
    complete &&
    !confidenceFailed &&
    requiredContactFieldsComplete

  const changeDraft = <
    K extends keyof ContactDraft
  >(
    key: K,
    value: ContactDraft[K]
  ) => {
    setWorkingSession((current) => ({
      ...current,
      draft: {
        ...current.draft,
        [key]: value,
      },
    }))
  }

  const changeOCRField = (
    key: OCRFieldKey,
    value: string
  ) => {
    setWorkingSession((current) => {
      const updatedFields =
        current.fields.map((field) =>
          field.key === key
            ? {
                ...field,
                value,
              }
            : field
        )

      return {
        ...current,
        fields: updatedFields,
        draft: {
          ...current.draft,
          [key]: value,
        },
      }
    })
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      {/* HEADER */}
      <div className="flex min-h-16 items-center justify-between gap-4 border-b px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ScanDocumentIcon size={18} />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">
                Document Intelligence Review
              </p>

              <Badge
                variant="outline"
                className="gap-1 text-[9px]"
              >
                <ShieldCheck className="size-3" />
                AI Assisted
              </Badge>
            </div>

            <p className="mt-0.5 max-w-[600px] truncate text-[10px] text-muted-foreground">
              {workingSession.file.name}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
        >
          <X className="size-5" />
        </Button>
      </div>

      {/* CONTENT */}
      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_460px]">
        {/* DOCUMENT */}
        <div className="min-h-0 border-r">
          <DocumentViewer
            session={workingSession}
            onReplace={onReplace}
          />
        </div>

        {/* EXTRACTION / CONTACT CREATION */}
        <div className="flex min-h-0 flex-col bg-background">
          <div className="border-b p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">
                  Contact Creation
                </p>

                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Review OCR data and complete the remaining contact information before saving.
                </p>
              </div>

              {complete && (
                <div className="text-right">
                  <p
                    className={`text-xl font-bold ${
                      confidenceFailed
                        ? "text-red-600"
                        : "text-emerald-600"
                    }`}
                  >
                    {confidence}%
                  </p>

                  <p className="text-[10px] text-muted-foreground">
                    OCR confidence
                  </p>
                </div>
              )}
            </div>

            {complete && (
              <div className="mt-4">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${
                      confidenceFailed
                        ? "bg-red-500"
                        : "bg-emerald-500"
                    }`}
                    style={{
                      width: `${confidence}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {workingSession.status ===
            "processing" ? (
              <div className="flex min-h-[500px] flex-col items-center justify-center text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
                  <Sparkles className="size-7 animate-pulse text-primary" />
                </div>

                <p className="mt-4 text-sm font-medium">
                  Reading the complete document...
                </p>

                <p className="mt-1 max-w-[300px] text-xs leading-5 text-muted-foreground">
                  TES is identifying document fields and calculating confidence before the record can be created.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {confidenceFailed && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:bg-red-950/10">
                    <div className="flex items-start gap-2">
                      <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />

                      <div>
                        <p className="text-xs font-semibold text-red-800 dark:text-red-300">
                          OCR confidence below acceptance threshold
                        </p>

                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                          One or more required identity fields are below {OCR_REQUIRED_THRESHOLD}%. Replace or recapture the document before saving.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {!confidenceFailed && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:bg-emerald-950/10">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />

                      <div>
                        <p className="text-xs font-semibold">
                          Document passed OCR confidence gate
                        </p>

                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                          Review the extracted values against the original document and complete the contact fields below.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <ContactFields
                  draft={
                    workingSession.draft
                  }
                  onChange={changeDraft}
                  ocrFields={fields}
                  showConfidence
                />
              </div>
            )}
          </div>

          {/* SAVE */}
          <div className="border-t bg-background p-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="text-[10px] text-muted-foreground">
                Required OCR threshold:{" "}
                <strong>
                  {OCR_REQUIRED_THRESHOLD}%
                </strong>
              </div>

              {workingSession.draft.isPrimary && (
                <Badge className="text-[9px]">
                  Primary Contact
                </Badge>
              )}
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={!canSave}
              onClick={() =>
                onSave(workingSession)
              }
            >
              <CheckCircle2 className="mr-2 size-4" />
              Save Contact
            </Button>

            {!requiredContactFieldsComplete &&
              complete && (
                <p className="mt-2 text-center text-[10px] text-muted-foreground">
                  First Name, Last Name, Email, Phone and Role / Relationship are required.
                </p>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   PAGE
========================================================= */

export default function ContactsPage() {
  const params = useParams()
  const router = useRouter()

  const companyId = params.id as string

  const deviceInputRef =
    useRef<HTMLInputElement | null>(null)

  const cameraInputRef =
    useRef<HTMLInputElement | null>(null)

  const [
    documentSourceMode,
    setDocumentSourceMode,
  ] = useState<
    "ocr_create" | "manual_attachment"
  >("ocr_create")

  const [
    showSourcePicker,
    setShowSourcePicker,
  ] = useState(false)

  const [company, setCompany] =
    useState<any>(null)

  const [contacts, setContacts] =
    useState<Contact[]>([])

  const [
    selectedContactId,
    setSelectedContactId,
  ] = useState<string | null>(null)

  const [loading, setLoading] =
    useState(true)

  const [showManualForm, setShowManualForm] =
    useState(false)

  const [
    editingContact,
    setEditingContact,
  ] = useState<Contact | null>(null)

  const [manualDraft, setManualDraft] =
    useState<ContactDraft>(EMPTY_DRAFT)

  const [noteDraft, setNoteDraft] =
    useState("")

  const [search, setSearch] =
    useState("")

  const [statusFilter, setStatusFilter] =
    useState<"active" | "archived">(
      "active"
    )

  const [ocrSession, setOcrSession] =
    useState<OCRSession | null>(null)

  /* =======================================================
     LOAD
  ======================================================= */

  useEffect(() => {
    try {
      const companies = JSON.parse(
        localStorage.getItem(
          "tes_companies"
        ) || "[]"
      )

      const found = companies.find(
        (item: any) =>
          item.id === companyId
      )

      setCompany(found || null)

      /*
        v5 first.

        Fallback to previous prototype version so existing
        testing records are not silently lost.
      */
      const stored =
        localStorage.getItem(
          CONTACT_STORAGE
        ) ||
        localStorage.getItem(
          "tes_contacts_v4"
        ) ||
        localStorage.getItem(
          "tes_contacts_v3"
        )

      const parsed = stored
        ? JSON.parse(stored)
        : []

      setContacts(
        Array.isArray(parsed)
          ? parsed
          : []
      )
    } catch (error) {
      console.error(
        "Unable to load contacts:",
        error
      )
    } finally {
      setLoading(false)
    }
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
     COMPANY CONTACTS
  ======================================================= */

  const companyContacts = useMemo(() => {
    return contacts.filter((contact) =>
      contact.relationships?.some(
        (relationship) =>
          relationship.companyId ===
          companyId
      )
    )
  }, [contacts, companyId])

  /*
    PRIMARY PINNING RULE:

    Active Primary Contact
       ↓
    Remaining active contacts
       ↓
    Archived records only when archived filter selected
  */
  const displayedContacts = useMemo(() => {
    const query =
      search.trim().toLowerCase()

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

        if (!query) return true

        return [
          contact.firstName,
          contact.lastName,
          `${contact.firstName} ${contact.lastName}`,
          contact.email,
          contact.phone,
          contact.role,
          contact.dlNumber,
          contact.globalId,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query)
        )
      })
      .sort((a, b) => {
        /*
          Primary always wins.
        */
        if (
          a.isPrimary !== b.isPrimary
        ) {
          return a.isPrimary ? -1 : 1
        }

        return `${a.firstName} ${a.lastName}`.localeCompare(
          `${b.firstName} ${b.lastName}`
        )
      })
  }, [
    companyContacts,
    search,
    statusFilter,
  ])

  const selectedContact =
    contacts.find(
      (contact) =>
        contact.id === selectedContactId
    ) || null

  const activeCount =
    companyContacts.filter(
      (contact) =>
        !contact.isArchived
    ).length

  const primaryContact =
    companyContacts.find(
      (contact) =>
        contact.isPrimary &&
        !contact.isArchived
    )

  const verifiedCount =
    companyContacts.filter(
      (contact) =>
        !contact.isArchived &&
        contact.identityStatus ===
          "verified"
    ).length

  const reviewCount =
    companyContacts.filter(
      (contact) =>
        !contact.isArchived &&
        contact.identityStatus ===
          "review_required"
    ).length

  /* =======================================================
     PRIMARY RULE
  ======================================================= */

  const applyPrimaryRule = (
    incoming: Contact,
    currentContacts: Contact[]
  ) => {
    if (!incoming.isPrimary) {
      return currentContacts
    }

    return currentContacts.map(
      (contact) => {
        if (
          contact.id === incoming.id
        ) {
          return contact
        }

        const belongsToCompany =
          contact.relationships?.some(
            (relationship) =>
              relationship.companyId ===
                companyId &&
              relationship.status ===
                "active"
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
          `Primary contact designation transferred to ${incoming.firstName} ${incoming.lastName}.`
        )
      }
    )
  }

  /* =======================================================
     CREATE CONTACT
  ======================================================= */

  const createContact = (
    draft: ContactDraft,
    options?: {
      evidence?: Evidence
      confidence?: number
      source?: "manual" | "document"
    }
  ) => {
    if (!company) return

    const timestamp = now()

    const relationship: Relationship = {
      id: makeId("REL"),
      companyId,
      companyName: company.name,
      role: draft.role,
      status: "active",
      startDate:
        timestamp.slice(0, 10),
      source:
        options?.source ===
        "document"
          ? "document"
          : "manual",
    }

    let contact: Contact = {
      id: makeId("CNT"),
      globalId: makeId("USR"),

      firstName:
        draft.firstName.trim(),
      lastName:
        draft.lastName.trim(),

      dob: draft.dob,

      dlNumber:
        draft.dlNumber.trim(),
      dlState:
        draft.dlState.trim(),
      dlExpiry:
        draft.dlExpiry,
      dlIssueDate:
        draft.dlIssueDate,
      dlClass:
        draft.dlClass.trim(),
      dlRestrictions:
        draft.dlRestrictions.trim(),

      email: draft.email.trim(),
      phone: draft.phone.trim(),

      role: draft.role,
      isPrimary:
        draft.isPrimary,

      isArchived: false,

      createdAt: timestamp,
      updatedAt: timestamp,

      notes: "",

      identityStatus:
        options?.evidence
          ? "verified"
          : "unverified",

      identityConfidence:
        options?.confidence,

      relationships: [
        relationship,
      ],

      evidence:
        options?.evidence
          ? [options.evidence]
          : [],

      events: [],
    }

    contact = appendEvent(
      contact,
      "CONTACT_CREATED",
      options?.source ===
        "document"
        ? `Contact created from reviewed identity document. OCR confidence ${options.confidence || 0}%.`
        : "Contact created manually."
    )

    let updated = [
      contact,
      ...contacts,
    ]

    updated = applyPrimaryRule(
      contact,
      updated
    )

    setContacts(updated)
    setSelectedContactId(contact.id)
    setNoteDraft("")
  }

  /* =======================================================
     MANUAL ADD
  ======================================================= */

  const openManualAdd = () => {
    setEditingContact(null)

    setManualDraft({
      ...EMPTY_DRAFT,
    })

    setShowManualForm(true)
  }

  const updateManualDraft = <
    K extends keyof ContactDraft
  >(
    key: K,
    value: ContactDraft[K]
  ) => {
    setManualDraft((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const saveManualContact = (
    event: React.FormEvent
  ) => {
    event.preventDefault()

    if (
      !manualDraft.firstName.trim() ||
      !manualDraft.lastName.trim() ||
      !manualDraft.email.trim() ||
      !manualDraft.phone.trim() ||
      !manualDraft.role
    ) {
      return
    }

    createContact(manualDraft, {
      source: "manual",
    })

    setShowManualForm(false)

    setManualDraft({
      ...EMPTY_DRAFT,
    })
  }

  /* =======================================================
     OCR SOURCE
  ======================================================= */

  const openOCRCreate = () => {
    setDocumentSourceMode(
      "ocr_create"
    )

    setShowSourcePicker(true)
  }

  const openManualDocument = () => {
    setDocumentSourceMode(
      "manual_attachment"
    )

    setShowSourcePicker(true)
  }

  const chooseCamera = () => {
    setShowSourcePicker(false)

    cameraInputRef.current?.click()
  }

  const chooseDevice = () => {
    setShowSourcePicker(false)

    deviceInputRef.current?.click()
  }

  /* =======================================================
     FILE INGESTION
  ======================================================= */

  const beginDocumentProcessing =
    async (
      file: File,
      source: DocumentSource
    ) => {
      const valid =
        file.type.startsWith(
          "image/"
        ) ||
        file.type ===
          "application/pdf"

      if (!valid) {
        window.alert(
          "Please upload a PDF or image document."
        )

        return
      }

      const dataUrl =
        await readFileAsDataUrl(file)

      const baseDraft =
        documentSourceMode ===
        "manual_attachment"
          ? manualDraft
          : {
              ...EMPTY_DRAFT,
            }

      const session: OCRSession = {
        file,
        dataUrl,
        source,
        status: "processing",
        fields: [],
        draft: baseDraft,
        mode:
          documentSourceMode,
      }

      setOcrSession(session)

      /*
        ===============================================
        REAL OCR INTEGRATION POINT

        Replace ONLY this processing section.

        Expected server response:
        {
          documentType,
          quality,
          fields: [
            {
              key,
              value,
              confidence
            }
          ]
        }

        Everything after this point should remain reusable.
        ===============================================
      */

      window.setTimeout(() => {
        setOcrSession(
          (current) => {
            if (!current) return null

            const fields =
              OCR_DEMO_FIELDS.map(
                (field) => ({
                  ...field,
                })
              )

            const extractedDraft: ContactDraft =
              {
                ...current.draft,

                firstName:
                  getOCRField(
                    fields,
                    "firstName"
                  ) ||
                  current.draft
                    .firstName,

                lastName:
                  getOCRField(
                    fields,
                    "lastName"
                  ) ||
                  current.draft.lastName,

                dob:
                  getOCRField(
                    fields,
                    "dob"
                  ) ||
                  current.draft.dob,

                dlNumber:
                  getOCRField(
                    fields,
                    "dlNumber"
                  ) ||
                  current.draft
                    .dlNumber,

                dlState:
                  getOCRField(
                    fields,
                    "dlState"
                  ) ||
                  current.draft
                    .dlState,

                dlExpiry:
                  getOCRField(
                    fields,
                    "dlExpiry"
                  ) ||
                  current.draft
                    .dlExpiry,

                dlIssueDate:
                  getOCRField(
                    fields,
                    "dlIssueDate"
                  ) ||
                  current.draft
                    .dlIssueDate,

                dlClass:
                  getOCRField(
                    fields,
                    "dlClass"
                  ) ||
                  current.draft
                    .dlClass,

                dlRestrictions:
                  getOCRField(
                    fields,
                    "dlRestrictions"
                  ) ||
                  current.draft
                    .dlRestrictions,
              }

            return {
              ...current,
              status: "complete",
              fields,
              draft:
                extractedDraft,
            }
          }
        )
      }, 1500)
    }

  const handleDeviceFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file =
      event.target.files?.[0]

    event.target.value = ""

    if (!file) return

    await beginDocumentProcessing(
      file,
      "device"
    )
  }

  const handleCameraFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file =
      event.target.files?.[0]

    event.target.value = ""

    if (!file) return

    await beginDocumentProcessing(
      file,
      "camera"
    )
  }

  /* =======================================================
     OCR REPLACE
  ======================================================= */

  const replaceDocument = () => {
    if (!ocrSession) return

    setDocumentSourceMode(
      ocrSession.mode
    )

    setOcrSession(null)

    setShowSourcePicker(true)
  }

  /* =======================================================
     OCR SAVE
  ======================================================= */

  const saveOCRContact = (
    session: OCRSession
  ) => {
    const confidence =
      averageConfidence(
        session.fields
      )

    if (
      hasOCRConfidenceFailure(
        session.fields
      )
    ) {
      return
    }

    const evidence: Evidence = {
      id: makeId("DOC"),
      type: "Driver Licence",
      fileName:
        session.file.name,
      fileType:
        session.file.type,
      uploadedAt: now(),
      confidence,
      status: "verified",
      source: session.source,
      dataUrl: session.dataUrl,
    }

    /*
      If manual entry was in progress and document was attached,
      the same OCR workspace becomes the final save route.
    */
    createContact(session.draft, {
      evidence,
      confidence,
      source: "document",
    })

    setOcrSession(null)
    setShowManualForm(false)

    setManualDraft({
      ...EMPTY_DRAFT,
    })
  }

  /* =======================================================
     ARCHIVE
  ======================================================= */

  const archiveContact = (
    contact: Contact
  ) => {
    const reason =
      window.prompt(
        `Archive ${contact.firstName} ${contact.lastName}?\n\nEnter archive reason:`
      )

    if (!reason?.trim()) return

    setContacts((current) =>
      current.map((item) => {
        if (
          item.id !== contact.id
        ) {
          return item
        }

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

  const restoreContact = (
    contact: Contact
  ) => {
    setContacts((current) =>
      current.map((item) => {
        if (
          item.id !== contact.id
        ) {
          return item
        }

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
     NOTE
  ======================================================= */

  const saveNote = () => {
    if (
      !selectedContact ||
      !noteDraft.trim()
    ) {
      return
    }

    setContacts((current) =>
      current.map((contact) => {
        if (
          contact.id !==
          selectedContact.id
        ) {
          return contact
        }

        return appendEvent(
          {
            ...contact,
            notes:
              noteDraft.trim(),
          },
          "NOTE_ADDED",
          "Internal contact note updated."
        )
      })
    )
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Loading contacts...
      </div>
    )
  }

  if (!company) {
    return (
      <div className="p-10 text-center">
        <p className="font-semibold">
          Company Not Found
        </p>
      </div>
    )
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 pb-12">
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

            <div className="min-w-0 flex-1">
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

              <p className="mt-1 text-sm text-muted-foreground">
                {company.name} · Personnel identity and relationship records
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={openOCRCreate}
                className="text-primary"
              >
                <ScanDocumentIcon size={15} />

                <span className="ml-2">
                  Upload ID for OCR
                </span>
              </Button>

              <Button
                onClick={openManualAdd}
              >
                <Plus className="mr-2 size-4" />
                Add Contact
              </Button>
            </div>
          </div>

          {/* STATUS */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="size-4" />
                  Active Contacts
                </div>

                <p className="mt-1 text-2xl font-semibold">
                  {activeCount}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <UserCheck className="size-4" />
                  Primary Contact
                </div>

                <p className="mt-1 truncate text-sm font-semibold">
                  {primaryContact
                    ? `${primaryContact.firstName} ${primaryContact.lastName}`
                    : "Not assigned"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="size-4" />
                  Verified
                </div>

                <p className="mt-1 text-2xl font-semibold">
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
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="size-4" />
                  Review Required
                </div>

                <p className="mt-1 text-2xl font-semibold">
                  {reviewCount}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* MANUAL FORM */}
        {showManualForm && (
          <Card className="border-primary/20">
            <CardHeader className="border-b bg-primary/[0.025]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">
                    Add Contact Manually
                  </CardTitle>

                  <CardDescription className="mt-1">
                    Manual and OCR creation use the same contact record structure.
                  </CardDescription>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setShowManualForm(
                      false
                    )
                  }
                >
                  <X className="size-4" />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-6">
              <form
                onSubmit={
                  saveManualContact
                }
                className="space-y-6"
              >
                <ContactFields
                  draft={manualDraft}
                  onChange={
                    updateManualDraft
                  }
                />

                {/* OPTIONAL DOCUMENT */}
                <div className="rounded-xl border bg-muted/20 p-4">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                    <div>
                      <p className="text-sm font-semibold">
                        Identity Document
                      </p>

                      <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                        Optional for manual entry. If attached, the document uses the exact same OCR, quality and confidence workflow as OCR-first creation.
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={
                        openManualDocument
                      }
                    >
                      <ScanDocumentIcon size={14} />

                      <span className="ml-2">
                        Attach Identity Document
                      </span>
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t pt-5">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setShowManualForm(
                        false
                      )
                    }
                  >
                    Cancel
                  </Button>

                  <Button type="submit">
                    Save Contact
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* MAIN WORKSPACE */}
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* DIRECTORY */}
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/20">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div>
                  <CardTitle className="text-base">
                    Contact Register
                  </CardTitle>

                  <CardDescription className="mt-1 text-xs">
                    Primary Contact is permanently pinned above other active contacts.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />

                    <Input
                      value={search}
                      onChange={(event) =>
                        setSearch(
                          event.target.value
                        )
                      }
                      placeholder="Search contacts..."
                      className="w-[220px] pl-9"
                    />
                  </div>

                  <Select
                    value={statusFilter}
                    onValueChange={(
                      value:
                        | "active"
                        | "archived"
                    ) =>
                      setStatusFilter(
                        value
                      )
                    }
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
              {displayedContacts.length ===
              0 ? (
                <div className="p-14 text-center">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
                    <Users className="size-6 text-muted-foreground" />
                  </div>

                  <p className="mt-4 text-sm font-medium">
                    No contacts in this view
                  </p>

                  <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                    Create the contact manually or use OCR to create the contact directly from an identity document.
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {displayedContacts.map(
                    (contact) => {
                      const selected =
                        selectedContactId ===
                        contact.id

                      return (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => {
                            setSelectedContactId(
                              contact.id
                            )

                            setNoteDraft(
                              contact.notes ||
                                ""
                            )
                          }}
                          className={`grid w-full gap-4 border-l-4 p-4 text-left transition-colors md:grid-cols-[minmax(0,1fr)_230px_150px] md:items-center ${
                            selected
                              ? "border-l-primary bg-primary/[0.04]"
                              : "border-l-transparent hover:bg-muted/30"
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-background">
                              <User className="size-5 text-muted-foreground" />
                            </div>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">
                                  {
                                    contact.firstName
                                  }{" "}
                                  {
                                    contact.lastName
                                  }
                                </span>

                                {contact.isPrimary &&
                                  !contact.isArchived && (
                                    <Badge className="h-5 px-2 text-[9px]">
                                      Primary Contact
                                    </Badge>
                                  )}

                                {contact.isArchived && (
                                  <Badge
                                    variant="secondary"
                                    className="h-5 px-2 text-[9px]"
                                  >
                                    Archived
                                  </Badge>
                                )}
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {
                                    contact.role
                                  }
                                </span>

                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {
                                    contact.globalId
                                  }
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="min-w-0 text-xs">
                            <p className="truncate">
                              {
                                contact.email
                              }
                            </p>

                            <p className="mt-1 text-muted-foreground">
                              {
                                contact.phone
                              }
                            </p>
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            {contact.identityStatus ===
                              "verified" && (
                              <Badge
                                variant="outline"
                                className="gap-1 text-[9px]"
                              >
                                <CheckCircle2 className="size-3" />
                                Verified
                              </Badge>
                            )}

                            <ChevronRight className="size-4 text-muted-foreground/50" />
                          </div>
                        </button>
                      )
                    }
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* INSPECTOR */}
          <div className="xl:sticky xl:top-6">
            {!selectedContact ? (
              <Card className="border-dashed">
                <CardContent className="flex min-h-[480px] flex-col items-center justify-center p-10 text-center">
                  <div className="flex size-14 items-center justify-center rounded-full bg-muted">
                    <User className="size-7 text-muted-foreground/50" />
                  </div>

                  <p className="mt-4 text-sm font-medium">
                    Select a contact
                  </p>

                  <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted-foreground">
                    View identity, evidence, relationship details and record history.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <CardHeader className="border-b bg-primary/[0.035]">
                  <div className="flex items-start gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-full border bg-background">
                      <User className="size-5 text-primary" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">
                          {
                            selectedContact.firstName
                          }{" "}
                          {
                            selectedContact.lastName
                          }
                        </CardTitle>

                        {selectedContact.isPrimary &&
                          !selectedContact.isArchived && (
                            <Badge className="text-[9px]">
                              Primary Contact
                            </Badge>
                          )}
                      </div>

                      <CardDescription className="mt-1">
                        {
                          selectedContact.role
                        }
                      </CardDescription>

                      <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                        {
                          selectedContact.globalId
                        }
                      </p>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5 p-4">
                  {/* IDENTITY */}
                  <section>
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Identity
                      </Label>

                      {selectedContact.identityConfidence !==
                        undefined && (
                        <span className="text-xs font-semibold">
                          {
                            selectedContact.identityConfidence
                          }
                          %
                        </span>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">
                          DOB
                        </p>

                        <p className="mt-1 font-medium">
                          {selectedContact.dob ||
                            "Not recorded"}
                        </p>
                      </div>

                      <div>
                        <p className="text-muted-foreground">
                          Licence
                        </p>

                        <p className="mt-1 font-medium">
                          {selectedContact.dlNumber ||
                            "Not recorded"}
                        </p>
                      </div>

                      <div>
                        <p className="text-muted-foreground">
                          Issuing Region
                        </p>

                        <p className="mt-1 font-medium">
                          {selectedContact.dlState ||
                            "Not recorded"}
                        </p>
                      </div>

                      <div>
                        <p className="text-muted-foreground">
                          Expiry
                        </p>

                        <p className="mt-1 font-medium">
                          {selectedContact.dlExpiry ||
                            "Not recorded"}
                        </p>
                      </div>

                      <div>
                        <p className="text-muted-foreground">
                          Class
                        </p>

                        <p className="mt-1 font-medium">
                          {selectedContact.dlClass ||
                            "Not recorded"}
                        </p>
                      </div>

                      <div>
                        <p className="text-muted-foreground">
                          Restrictions
                        </p>

                        <p className="mt-1 font-medium">
                          {selectedContact.dlRestrictions ||
                            "None recorded"}
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* EVIDENCE */}
                  <section className="border-t pt-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Identity Evidence
                      </Label>

                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px]"
                        onClick={() => {
                          setManualDraft({
                            firstName:
                              selectedContact.firstName,
                            lastName:
                              selectedContact.lastName,
                            dob:
                              selectedContact.dob,

                            dlNumber:
                              selectedContact.dlNumber,
                            dlState:
                              selectedContact.dlState,
                            dlExpiry:
                              selectedContact.dlExpiry,
                            dlIssueDate:
                              selectedContact.dlIssueDate,
                            dlClass:
                              selectedContact.dlClass,
                            dlRestrictions:
                              selectedContact.dlRestrictions,

                            email:
                              selectedContact.email,
                            phone:
                              selectedContact.phone,

                            role:
                              selectedContact.role,
                            isPrimary:
                              selectedContact.isPrimary,
                          })

                          openManualDocument()
                        }}
                      >
                        <ScanDocumentIcon size={12} />
                        <span className="ml-1.5">
                          Add
                        </span>
                      </Button>
                    </div>

                    <div className="mt-3 space-y-2">
                      {selectedContact.evidence?.length ? (
                        selectedContact.evidence.map(
                          (document) => (
                            <div
                              key={document.id}
                              className="rounded-lg border p-3"
                            >
                              <div className="flex items-start gap-3">
                                <FileCheck2 className="mt-0.5 size-4 shrink-0 text-primary" />

                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-medium">
                                    {
                                      document.fileName
                                    }
                                  </p>

                                  <p className="mt-1 text-[10px] text-muted-foreground">
                                    {
                                      document.type
                                    }

                                    {document.confidence !==
                                      undefined &&
                                      ` · ${document.confidence}% confidence`}
                                  </p>
                                </div>

                                <Badge
                                  variant="outline"
                                  className="text-[9px]"
                                >
                                  {
                                    document.status
                                  }
                                </Badge>
                              </div>
                            </div>
                          )
                        )
                      ) : (
                        <div className="rounded-lg border border-dashed p-5 text-center">
                          <FileText className="mx-auto size-5 text-muted-foreground/40" />

                          <p className="mt-2 text-xs font-medium">
                            No identity evidence attached
                          </p>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* NOTES */}
                  <section className="border-t pt-4">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Internal Notes
                    </Label>

                    <Textarea
                      value={noteDraft}
                      onChange={(event) =>
                        setNoteDraft(
                          event.target.value
                        )
                      }
                      className="mt-2 min-h-[110px] resize-none"
                      placeholder="Add operational notes..."
                    />

                    <Button
                      className="mt-2 w-full"
                      size="sm"
                      disabled={
                        !noteDraft.trim()
                      }
                      onClick={saveNote}
                    >
                      Save Note
                    </Button>
                  </section>

                  {/* HISTORY */}
                  <section className="border-t pt-4">
                    <div className="flex items-center gap-2">
                      <History className="size-3.5 text-primary" />

                      <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Recent History
                      </Label>
                    </div>

                    <div className="mt-3 max-h-[220px] space-y-2 overflow-y-auto">
                      {selectedContact.events
                        ?.slice(0, 6)
                        .map((event) => (
                          <div
                            key={event.id}
                            className="rounded-lg border p-3"
                          >
                            <p className="text-[10px] font-semibold">
                              {event.type.replaceAll(
                                "_",
                                " "
                              )}
                            </p>

                            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                              {
                                event.description
                              }
                            </p>

                            <p className="mt-2 text-[9px] text-muted-foreground">
                              {new Date(
                                event.timestamp
                              ).toLocaleString()}
                            </p>
                          </div>
                        ))}
                    </div>
                  </section>

                  {/* ARCHIVE */}
                  <div className="border-t pt-4">
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
                        <ArchiveRestore className="mr-2 size-4" />
                        Restore Contact
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() =>
                          archiveContact(
                            selectedContact
                          )
                        }
                      >
                        <Archive className="mr-2 size-4" />
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

      {/* SOURCE PICKER */}
      {showSourcePicker && (
        <DocumentSourcePicker
          title={
            documentSourceMode ===
            "ocr_create"
              ? "Upload ID for OCR"
              : "Attach Identity Document"
          }
          onCamera={chooseCamera}
          onDevice={chooseDevice}
          onCancel={() =>
            setShowSourcePicker(false)
          }
        />
      )}

      {/* OCR WORKSPACE */}
      {ocrSession && (
        <OCRContactWorkspace
          session={ocrSession}
          onClose={() =>
            setOcrSession(null)
          }
          onReplace={
            replaceDocument
          }
          onSave={saveOCRContact}
        />
      )}

      {/* CAMERA INPUT */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCameraFile}
      />

      {/* DEVICE INPUT */}
      <input
        ref={deviceInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={handleDeviceFile}
      />
    </>
  )
}
