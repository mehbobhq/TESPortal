"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  useParams,
  useRouter,
} from "next/navigation"
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  Eye,
  FileKey2,
  FileText,
  HardHat,
  History,
  Loader2,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Upload,
  X,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/* =========================================================
   TYPES
========================================================= */

type ExpiryRules = {
  healthyMinDays: number
  watchMinDays: number
  urgentMinDays: number
  criticalMinDays: number
  criticalMaxDays: number
}

type SystemSettings = {
  version: number
  expiryRules: ExpiryRules
  updatedAt?: string
  updatedBy?: string
}

type RecordStatus =
  | "Healthy"
  | "Watch"
  | "Urgent"
  | "Critical"
  | "Expired"
  | "Archived"

type SourceType = "Manual" | "OCR"

type RecordFamily =
  | "transportation"
  | "workers"
  | "bond"

type OcrStatus =
  | "Not Used"
  | "Ready"
  | "Processing"
  | "Needs Review"
  | "Verified"

type InsuranceRecord = {
  id: string

  family: RecordFamily

  type: string
  number: string

  provider: string
  broker?: string

  limits?: string
  principal?: string
  amount?: string

  effective: string
  expiry?: string

  status: RecordStatus

  source: SourceType

  documentName?: string
  documentType?: string

  ocrStatus: OcrStatus
  ocrConfidence?: number

  createdAt: string
  updatedAt?: string

  archivedAt?: string
  archivedBy?: string
  archiveReason?: string
}

type Company = {
  id: string
  name: string
  region?: string

  /*
    IMPORTANT:
    These names intentionally remain unchanged because other
    TES pages already depend on the same company fields.
  */
  regCorpState?: string
  regCorpCountry?: string
}

/* =========================================================
   SETTINGS
========================================================= */

const SETTINGS_STORAGE_KEY =
  "tes_system_settings"

const DEFAULT_EXPIRY_RULES: ExpiryRules = {
  healthyMinDays: 61,
  watchMinDays: 31,
  urgentMinDays: 11,
  criticalMinDays: 0,
  criticalMaxDays: 10,
}

function loadSystemSettings(): SystemSettings {
  const fallback: SystemSettings = {
    version: 1,
    expiryRules: DEFAULT_EXPIRY_RULES,
  }

  if (typeof window === "undefined") {
    return fallback
  }

  try {
    const raw = localStorage.getItem(
      SETTINGS_STORAGE_KEY
    )

    if (!raw) return fallback

    const parsed = JSON.parse(raw)

    return {
      ...fallback,
      ...parsed,
      expiryRules: {
        ...DEFAULT_EXPIRY_RULES,
        ...(parsed.expiryRules || {}),
      },
    }
  } catch {
    return fallback
  }
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
        className="relative"
        style={{
          width: size * 0.58,
          height: size * 0.58,
          strokeWidth: 1.8,
        }}
      />
    </span>
  )
}

/* =========================================================
   DATE / STATUS ENGINE
========================================================= */

function getDaysUntilExpiry(
  expiry?: string
) {
  if (!expiry) return null

  const now = new Date()

  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  )

  const expiryDate = new Date(
    `${expiry}T23:59:59`
  )

  return Math.ceil(
    (expiryDate.getTime() -
      today.getTime()) /
      86400000
  )
}

function getRecordStatus(
  expiry: string | undefined,
  rules: ExpiryRules,
  archived = false
): RecordStatus {
  if (archived) {
    return "Archived"
  }

  /*
    Continuous / non-expiring records are considered
    healthy unless another compliance rule says otherwise.
  */
  if (!expiry) {
    return "Healthy"
  }

  const days =
    getDaysUntilExpiry(expiry)

  if (days === null) {
    return "Healthy"
  }

  if (days < 0) {
    return "Expired"
  }

  if (
    days >= rules.criticalMinDays &&
    days <= rules.criticalMaxDays
  ) {
    return "Critical"
  }

  if (
    days >= rules.urgentMinDays &&
    days < rules.watchMinDays
  ) {
    return "Urgent"
  }

  if (
    days >= rules.watchMinDays &&
    days < rules.healthyMinDays
  ) {
    return "Watch"
  }

  return "Healthy"
}

/* =========================================================
   STATUS PRESENTATION
========================================================= */

function getStatusClasses(
  status: RecordStatus
) {
  switch (status) {
    case "Healthy":
      return {
        badge:
          "border-emerald-200 bg-emerald-50 text-emerald-800",
        row: "",
        date: "text-emerald-700",
      }

    case "Watch":
      return {
        badge:
          "border-amber-200 bg-amber-50 text-amber-800",
        row: "bg-amber-50/20",
        date: "text-amber-700",
      }

    case "Urgent":
      return {
        badge:
          "border-red-200 bg-red-50 text-red-700",
        row: "bg-red-50/20",
        date: "text-red-700",
      }

    case "Critical":
      return {
        badge:
          "border-red-400 bg-red-100 text-red-900",
        row: "bg-red-50/40",
        date:
          "text-red-800 font-semibold",
      }

    case "Expired":
      return {
        badge:
          "border-red-700 bg-red-950 text-white",
        row: "bg-red-50/60",
        date:
          "text-red-950 font-bold",
      }

    case "Archived":
      return {
        badge:
          "border-slate-200 bg-slate-50 text-slate-600",
        row: "opacity-60",
        date: "text-muted-foreground",
      }
  }
}

function StatusBadge({
  status,
}: {
  status: RecordStatus
}) {
  const classes =
    getStatusClasses(status)

  const icon =
    status === "Healthy" ? (
      <CheckCircle2 className="size-3" />
    ) : status === "Watch" ? (
      <CalendarClock className="size-3" />
    ) : status === "Urgent" ? (
      <AlertTriangle className="size-3" />
    ) : status === "Critical" ? (
      <AlertTriangle className="size-3" />
    ) : status === "Expired" ? (
      <XCircle className="size-3" />
    ) : (
      <Archive className="size-3" />
    )

  return (
    <Badge
      variant="outline"
      className={`gap-1 ${classes.badge}`}
    >
      {icon}
      {status}
    </Badge>
  )
}

/* =========================================================
   DUPLICATE HELPERS
========================================================= */

function normalizeIdentifier(
  value?: string
) {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_/]/g, "")
}

function findDuplicatePolicy(
  records: InsuranceRecord[],
  number: string,
  excludeId?: string
) {
  const normalized =
    normalizeIdentifier(number)

  if (!normalized) return undefined

  return records.find(
    (record) =>
      record.id !== excludeId &&
      record.status !== "Archived" &&
      normalizeIdentifier(
        record.number
      ) === normalized
  )
}

/* =========================================================
   OCR DOCUMENT PANEL
========================================================= */

type OCRResult = {
  confidence: number
  type?: string
  number?: string
  provider?: string
  broker?: string
  limits?: string
  effective?: string
  expiry?: string
  amount?: string
  principal?: string
}

function OCRDocumentPanel({
  title,
  description,
  onFileSelected,
  onExtractionComplete,
}: {
  title: string
  description: string
  onFileSelected: (
    file: File | null
  ) => void
  onExtractionComplete: (
    result: OCRResult
  ) => void
}) {
  const inputRef =
    useRef<HTMLInputElement>(null)

  const [file, setFile] =
    useState<File | null>(null)

  const [previewUrl, setPreviewUrl] =
    useState<string | null>(null)

  const [processing, setProcessing] =
    useState(false)

  const [reviewReady, setReviewReady] =
    useState(false)

  const [confidence, setConfidence] =
    useState<number | null>(null)

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(
          previewUrl
        )
      }
    }
  }, [previewUrl])

  const clearFile = () => {
    if (previewUrl) {
      URL.revokeObjectURL(
        previewUrl
      )
    }

    setFile(null)
    setPreviewUrl(null)
    setProcessing(false)
    setReviewReady(false)
    setConfidence(null)

    if (inputRef.current) {
      inputRef.current.value = ""
    }

    onFileSelected(null)
  }

  const handleFile = (
    selected: File | null
  ) => {
    if (!selected) return

    if (previewUrl) {
      URL.revokeObjectURL(
        previewUrl
      )
    }

    const url =
      URL.createObjectURL(selected)

    setFile(selected)
    setPreviewUrl(url)

    setProcessing(false)
    setReviewReady(false)
    setConfidence(null)

    onFileSelected(selected)
  }

  const runOCR = async () => {
    if (!file) return

    setProcessing(true)
    setReviewReady(false)

    /*
      ========================================================
      TES OCR INTEGRATION POINT
      ========================================================

      Replace ONLY this simulated section when the real OCR
      service is connected.

      Required production flow:

      1. Upload original file
      2. Document quality validation
      3. OCR extraction
      4. Document classification
      5. Field extraction
      6. Confidence per field
      7. Overall confidence
      8. Duplicate identifier check
      9. Human review where required
      10. Verified save
      11. Master Register event

      IMPORTANT:
      The UI and data contract below are intentionally reusable.
    */

    await new Promise((resolve) =>
      setTimeout(resolve, 1000)
    )

    /*
      We deliberately DO NOT invent policy data.

      When the OCR API is connected, replace this object with
      the actual extraction response.
    */
    const simulatedResult: OCRResult = {
      confidence: 90,
    }

    setConfidence(
      simulatedResult.confidence
    )

    setProcessing(false)
    setReviewReady(true)

    onExtractionComplete(
      simulatedResult
    )
  }

  const openFullView = () => {
    if (!previewUrl) return

    window.open(
      previewUrl,
      "_blank",
      "noopener,noreferrer"
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <div className="border-b bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ScanDocumentIcon
                size={18}
              />
            </div>

            <div>
              <h4 className="text-sm font-semibold">
                {title}
              </h4>

              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          </div>

          {file && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={clearFile}
              title="Remove document"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {!file ? (
        <button
          type="button"
          onClick={() =>
            inputRef.current?.click()
          }
          className="flex w-full flex-col items-center justify-center p-10 text-center transition-colors hover:bg-muted/20"
        >
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ScanDocumentIcon
              size={23}
            />
          </div>

          <p className="text-sm font-semibold">
            Upload insurance document
          </p>

          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Select a PDF, JPG or PNG.
            The original document remains
            attached to the compliance
            record as evidence.
          </p>

          <div className="mt-4 inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs font-medium shadow-sm">
            <Upload className="size-3.5" />
            Choose File
          </div>
        </button>
      ) : (
        <div className="grid min-h-[420px] lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.45fr)]">
          {/* DOCUMENT */}

          <div className="border-b bg-muted/10 p-4 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Original Document
                </p>

                <p className="mt-1 max-w-[500px] truncate text-xs font-medium">
                  {file.name}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    inputRef.current?.click()
                  }
                >
                  <RefreshCcw className="mr-1.5 size-3.5" />
                  Replace
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={openFullView}
                >
                  <Eye className="mr-1.5 size-3.5" />
                  Full View
                </Button>
              </div>
            </div>

            <div className="flex h-[340px] items-center justify-center overflow-hidden rounded-lg border bg-background">
              {file.type ===
              "application/pdf" ? (
                <iframe
                  src={
                    previewUrl ||
                    undefined
                  }
                  className="h-full w-full"
                  title="Insurance document preview"
                />
              ) : (
                <img
                  src={
                    previewUrl ||
                    undefined
                  }
                  alt="Insurance document preview"
                  className="h-full w-full object-contain"
                />
              )}
            </div>
          </div>

          {/* PROCESSING */}

          <div className="flex flex-col p-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Document Intelligence
              </p>

              <div className="mt-5 space-y-5">
                <ProcessStep
                  complete
                  title="Document uploaded"
                  description="Original evidence is ready for review."
                />

                <ProcessStep
                  complete={
                    reviewReady
                  }
                  processing={
                    processing
                  }
                  title={
                    processing
                      ? "Reading document..."
                      : reviewReady
                        ? "Extraction complete"
                        : "OCR ready"
                  }
                  description={
                    reviewReady
                      ? "Review extracted fields against the original."
                      : "Run OCR to extract structured insurance information."
                  }
                />
              </div>

              {confidence !==
                null && (
                <div className="mt-5 rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      OCR confidence
                    </span>

                    <span className="text-sm font-bold">
                      {confidence}%
                    </span>
                  </div>

                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Confidence is shown
                    for testing. Final
                    acceptance behavior
                    will use the central
                    Document Intelligence
                    rules in Portal
                    Settings.
                  </p>
                </div>
              )}
            </div>

            {!reviewReady ? (
              <Button
                type="button"
                className="mt-auto"
                onClick={runOCR}
                disabled={processing}
              >
                {processing ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <ScanDocumentIcon
                      size={15}
                    />
                    <span className="ml-2">
                      Run OCR
                    </span>
                  </>
                )}
              </Button>
            ) : (
              <div className="mt-auto rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />

                  <div>
                    <p className="text-xs font-semibold text-amber-900">
                      Verify extracted
                      information
                    </p>

                    <p className="mt-1 text-xs leading-relaxed text-amber-800">
                      OCR assists data
                      entry. The reviewed
                      information becomes
                      authoritative only
                      after saving.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(event) =>
          handleFile(
            event.target.files?.[0] ||
              null
          )
        }
      />
    </div>
  )
}

function ProcessStep({
  complete = false,
  processing = false,
  title,
  description,
}: {
  complete?: boolean
  processing?: boolean
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
          processing
            ? "bg-blue-100 text-blue-700"
            : complete
              ? "bg-emerald-100 text-emerald-700"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {processing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : complete ? (
          <Check className="size-3.5" />
        ) : (
          <ScanDocumentIcon
            size={13}
          />
        )}
      </div>

      <div>
        <p className="text-sm font-medium">
          {title}
        </p>

        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}

/* =========================================================
   RECORD FORM
========================================================= */

type RecordDraft = Omit<
  InsuranceRecord,
  | "id"
  | "createdAt"
  | "status"
  | "archivedAt"
  | "archivedBy"
  | "archiveReason"
>

function RecordForm({
  title,
  recordType,
  company,
  records,
  initialSource,
  onSave,
  onCancel,
}: {
  title: string
  recordType: RecordFamily
  company: Company
  records: InsuranceRecord[]
  initialSource: SourceType
  onSave: (
    record: RecordDraft
  ) => void
  onCancel: () => void
}) {
  const [source, setSource] =
    useState<SourceType>(
      initialSource
    )

  const [document, setDocument] =
    useState<File | null>(null)

  const [ocrConfidence, setOcrConfidence] =
    useState<number | undefined>()

  const [type, setType] =
    useState("")

  const [number, setNumber] =
    useState("")

  const [provider, setProvider] =
    useState("")

  const [broker, setBroker] =
    useState("")

  const [limits, setLimits] =
    useState("")

  const [principal, setPrincipal] =
    useState(company.name)

  const [amount, setAmount] =
    useState("")

  const [effective, setEffective] =
    useState("")

  const [expiry, setExpiry] =
    useState("")

  const [error, setError] =
    useState<string | null>(null)

  const duplicate = useMemo(
    () =>
      findDuplicatePolicy(
        records,
        number
      ),
    [records, number]
  )

  const applyOCRResult = (
    result: OCRResult
  ) => {
    setOcrConfidence(
      result.confidence
    )

    if (result.type) {
      setType(result.type)
    }

    if (result.number) {
      setNumber(result.number)
    }

    if (result.provider) {
      setProvider(
        result.provider
      )
    }

    if (result.broker) {
      setBroker(result.broker)
    }

    if (result.limits) {
      setLimits(result.limits)
    }

    if (result.amount) {
      setAmount(result.amount)
    }

    if (result.principal) {
      setPrincipal(
        result.principal
      )
    }

    if (result.effective) {
      setEffective(
        result.effective
      )
    }

    if (result.expiry) {
      setExpiry(result.expiry)
    }
  }

  const submit = (
    event: React.FormEvent
  ) => {
    event.preventDefault()

    setError(null)

    if (!type) {
      setError(
        "Select a record type."
      )
      return
    }

    if (!number.trim()) {
      setError(
        "Policy / account number is required."
      )
      return
    }

    if (!provider.trim()) {
      setError(
        "Carrier / provider is required."
      )
      return
    }

    if (!effective) {
      setError(
        "Effective date is required."
      )
      return
    }

    if (
      recordType !== "bond" &&
      !expiry
    ) {
      setError(
        "Expiry date is required."
      )
      return
    }

    if (
      effective &&
      expiry &&
      new Date(expiry) <
        new Date(effective)
    ) {
      setError(
        "Expiry date cannot be earlier than the effective date."
      )
      return
    }

    if (duplicate) {
      setError(
        `Possible duplicate detected: ${duplicate.type} already uses identifier ${duplicate.number}.`
      )
      return
    }

    onSave({
      family: recordType,
      type,
      number: number.trim(),
      provider:
        provider.trim(),
      broker: broker.trim(),
      limits: limits.trim(),
      principal:
        principal.trim(),
      amount: amount.trim(),
      effective,
      expiry,

      source,

      documentName:
        document?.name,

      documentType:
        document?.type,

      /*
        IMPORTANT:
        We intentionally do NOT persist an object URL.
        blob: URLs are browser-session references and are
        not valid permanent document storage.

        Production document storage will replace this with
        a durable document/evidence ID.
      */

      ocrStatus:
        source === "OCR"
          ? "Needs Review"
          : "Not Used",

      ocrConfidence,
    })
  }

  return (
    <form
      onSubmit={submit}
      className="border-b bg-primary/[0.02]"
    >
      <div className="border-b p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h3 className="text-sm font-semibold">
              {title}
            </h3>

            <p className="mt-1 text-xs text-muted-foreground">
              {source === "OCR"
                ? "Upload evidence, extract available information and verify the fields before saving."
                : "Enter the same authoritative fields manually. Supporting evidence can be added through the OCR workflow."}
            </p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>

        <div className="mt-4 flex w-fit rounded-lg border bg-background p-1">
          <button
            type="button"
            onClick={() => {
              setSource("Manual")
              setError(null)
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              source === "Manual"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Manual Entry
          </button>

          <button
            type="button"
            onClick={() => {
              setSource("OCR")
              setError(null)
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              source === "OCR"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <ScanDocumentIcon
                size={13}
              />
              Scan Document
            </span>
          </button>
        </div>
      </div>

      {source === "OCR" && (
        <div className="border-b p-5">
          <OCRDocumentPanel
            title="Insurance Evidence"
            description="Upload the original policy, COI, clearance certificate or bond document. TES will use this document as evidence for the resulting record."
            onFileSelected={
              setDocument
            }
            onExtractionComplete={
              applyOCRResult
            }
          />
        </div>
      )}

      <div className="p-5">
        <div className="mb-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Record Information
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            Manual and OCR entry use
            the same fields so the
            resulting record remains
            structurally consistent.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* TYPE */}

          <div className="space-y-2">
            <Label>
              Record Type *
            </Label>

            <Select
              value={type}
              onValueChange={
                setType
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>

              <SelectContent>
                {recordType ===
                  "transportation" && (
                  <>
                    <SelectItem value="Auto Liability">
                      Auto Liability
                    </SelectItem>

                    <SelectItem value="General Liability">
                      General Liability
                    </SelectItem>

                    <SelectItem value="Motor Truck Cargo">
                      Motor Truck Cargo
                    </SelectItem>

                    <SelectItem value="Physical Damage">
                      Physical Damage
                    </SelectItem>
                  </>
                )}

                {recordType ===
                  "workers" && (
                  <>
                    <SelectItem value="WSIB">
                      WSIB
                    </SelectItem>

                    <SelectItem value="WCB">
                      WCB
                    </SelectItem>

                    <SelectItem value="Workers Compensation">
                      Workers Compensation
                    </SelectItem>

                    <SelectItem value="Occupational Accident">
                      Occupational Accident
                    </SelectItem>
                  </>
                )}

                {recordType ===
                  "bond" && (
                  <>
                    <SelectItem value="US Customs Continuous">
                      US Customs Continuous
                    </SelectItem>

                    <SelectItem value="Freight Broker BMC-84">
                      Freight Broker
                      BMC-84
                    </SelectItem>

                    <SelectItem value="Performance Bond">
                      Performance Bond
                    </SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* NUMBER */}

          <div className="space-y-2">
            <Label>
              {recordType === "bond"
                ? "Bond Number *"
                : recordType ===
                    "workers"
                  ? "Account / Policy Number *"
                  : "Policy Number *"}
            </Label>

            <Input
              value={number}
              onChange={(event) =>
                setNumber(
                  event.target.value
                )
              }
              placeholder={
                recordType ===
                "bond"
                  ? "Bond identifier"
                  : "Policy / account identifier"
              }
            />

            {duplicate && (
              <p className="flex items-start gap-1.5 text-[11px] font-medium text-red-700">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                Duplicate identifier
                found in{" "}
                {duplicate.type}.
              </p>
            )}
          </div>

          {/* LIMIT / AMOUNT */}

          {recordType === "bond" ? (
            <div className="space-y-2">
              <Label>
                Bond Amount
              </Label>

              <Input
                value={amount}
                onChange={(event) =>
                  setAmount(
                    event.target
                      .value
                  )
                }
                placeholder="$50,000"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>
                {recordType ===
                "workers"
                  ? "Coverage / Account Detail"
                  : "Coverage Limit"}
              </Label>

              <Input
                value={limits}
                onChange={(event) =>
                  setLimits(
                    event.target
                      .value
                  )
                }
                placeholder={
                  recordType ===
                  "transportation"
                    ? "$1,000,000"
                    : "Optional"
                }
              />
            </div>
          )}

          {/* PROVIDER */}

          <div className="space-y-2 sm:col-span-2">
            <Label>
              {recordType ===
              "workers"
                ? "Issuing Board / Carrier *"
                : recordType ===
                    "bond"
                  ? "Surety Company *"
                  : "Insurance Carrier *"}
            </Label>

            <Input
              value={provider}
              onChange={(event) =>
                setProvider(
                  event.target.value
                )
              }
            />
          </div>

          {/* BROKER */}

          {recordType ===
            "transportation" && (
            <div className="space-y-2">
              <Label>
                Broker
              </Label>

              <Input
                value={broker}
                onChange={(event) =>
                  setBroker(
                    event.target
                      .value
                  )
                }
              />
            </div>
          )}

          {/* PRINCIPAL */}

          {recordType === "bond" && (
            <div className="space-y-2">
              <Label>
                Principal Name
              </Label>

              <Input
                value={principal}
                onChange={(event) =>
                  setPrincipal(
                    event.target
                      .value
                  )
                }
              />
            </div>
          )}

          {/* DATES */}

          <div className="space-y-2">
            <Label>
              Effective Date *
            </Label>

            <Input
              type="date"
              value={effective}
              onChange={(event) =>
                setEffective(
                  event.target.value
                )
              }
            />
          </div>

          <div className="space-y-2">
            <Label>
              Expiry Date
              {recordType !==
                "bond" && " *"}
            </Label>

            <Input
              type="date"
              value={expiry}
              onChange={(event) =>
                setExpiry(
                  event.target.value
                )
              }
            />

            {recordType === "bond" && (
              <p className="text-[11px] text-muted-foreground">
                Leave blank for a
                continuous bond.
              </p>
            )}
          </div>
        </div>

        {/* OCR REVIEW */}

        {source === "OCR" && (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />

              <div>
                <p className="text-xs font-semibold text-amber-900">
                  Human verification
                  before save
                </p>

                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  Compare the populated
                  fields with the original
                  evidence. OCR never
                  silently creates or
                  changes authoritative
                  compliance data.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ERROR */}

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />

            <p className="text-xs font-medium">
              {error}
            </p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>

          <Button
            type="submit"
            disabled={
              Boolean(duplicate)
            }
          >
            <Check className="mr-2 size-4" />
            Verify & Save
          </Button>
        </div>
      </div>
    </form>
  )
}

/* =========================================================
   RECORD ROW
========================================================= */

function RecordRow({
  record,
  onArchive,
}: {
  record: InsuranceRecord
  onArchive: (
    record: InsuranceRecord
  ) => void
}) {
  const classes =
    getStatusClasses(
      record.status
    )

  const days =
    getDaysUntilExpiry(
      record.expiry
    )

  return (
    <div
      className={`grid gap-4 p-4 transition-colors hover:bg-muted/20 md:grid-cols-12 ${classes.row}`}
    >
      {/* RECORD */}

      <div className="md:col-span-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">
            {record.type}
          </p>

          {record.source ===
            "OCR" && (
            <Badge
              variant="outline"
              className="px-1.5 py-0 text-[9px]"
            >
              <ScanDocumentIcon
                size={10}
              />
              <span className="ml-1">
                OCR
              </span>
            </Badge>
          )}
        </div>

        <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
          {record.number}
        </p>

        {record.documentName && (
          <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <FileText className="size-3" />
            <span className="truncate">
              {
                record.documentName
              }
            </span>
          </p>
        )}
      </div>

      {/* PROVIDER */}

      <div className="md:col-span-3">
        <p className="text-sm">
          {record.provider ||
            "—"}
        </p>

        {record.broker && (
          <p className="mt-1 text-xs text-muted-foreground">
            Broker:{" "}
            {record.broker}
          </p>
        )}

        {record.principal && (
          <p className="mt-1 text-xs text-muted-foreground">
            Principal:{" "}
            {record.principal}
          </p>
        )}
      </div>

      {/* LIMIT */}

      <div className="md:col-span-2">
        <p className="font-mono text-xs font-medium">
          {record.amount ||
            record.limits ||
            "—"}
        </p>
      </div>

      {/* DATES */}

      <div className="md:col-span-2 text-xs">
        <p className="text-muted-foreground">
          Effective:{" "}
          {record.effective ||
            "—"}
        </p>

        <p
          className={`mt-1 ${classes.date}`}
        >
          Expiry:{" "}
          {record.expiry ||
            "Continuous"}
        </p>

        {record.expiry &&
          days !== null && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {days < 0
                ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} expired`
                : days === 0
                  ? "Expires today"
                  : `${days} day${days === 1 ? "" : "s"} remaining`}
            </p>
          )}
      </div>

      {/* STATUS */}

      <div className="flex items-center gap-2 md:col-span-2 md:justify-end">
        <StatusBadge
          status={record.status}
        />

        {record.status !==
          "Archived" && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            title="Archive record"
            onClick={() =>
              onArchive(record)
            }
          >
            <Archive className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

/* =========================================================
   ARCHIVE CONFIRMATION
========================================================= */

function ArchivePanel({
  record,
  onConfirm,
  onCancel,
}: {
  record: InsuranceRecord
  onConfirm: (
    reason: string
  ) => void
  onCancel: () => void
}) {
  const [reason, setReason] =
    useState("")

  return (
    <div className="border-b border-amber-200 bg-amber-50/60 p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
          <Archive className="size-4" />
        </div>

        <div className="flex-1">
          <h4 className="text-sm font-semibold">
            Archive{" "}
            {record.type}
          </h4>

          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            This record will remain in
            TES as historical compliance
            evidence. It will not be
            deleted.
          </p>

          <div className="mt-4 max-w-xl space-y-2">
            <Label>
              Archive Reason *
            </Label>

            <Input
              value={reason}
              onChange={(event) =>
                setReason(
                  event.target.value
                )
              }
              placeholder="e.g. Policy replaced by renewal"
            />
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onCancel}
            >
              Cancel
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={
                !reason.trim()
              }
              onClick={() =>
                onConfirm(
                  reason.trim()
                )
              }
            >
              <Archive className="mr-2 size-4" />
              Confirm Archive
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   INSURANCE SECTION
========================================================= */

function InsuranceSection({
  title,
  description,
  icon,
  records,
  allRecords,
  recordType,
  company,
  onSave,
  onArchive,
}: {
  title: string
  description: string
  icon: React.ReactNode

  records: InsuranceRecord[]
  allRecords: InsuranceRecord[]

  recordType: RecordFamily

  company: Company

  onSave: (
    record: RecordDraft
  ) => void

  onArchive: (
    id: string,
    reason: string
  ) => void
}) {
  const [formOpen, setFormOpen] =
    useState(false)

  const [initialSource, setInitialSource] =
    useState<SourceType>("Manual")

  const [archiveTarget, setArchiveTarget] =
    useState<InsuranceRecord | null>(
      null
    )

  const activeRecords =
    records.filter(
      (record) =>
        record.status !==
        "Archived"
    )

  const openForm = (
    source: SourceType
  ) => {
    setInitialSource(source)
    setArchiveTarget(null)
    setFormOpen(true)
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/20 py-4">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              {icon}
              {title}
            </CardTitle>

            <CardDescription className="mt-1 text-xs">
              {description}
            </CardDescription>
          </div>

          {!formOpen && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  openForm("OCR")
                }
              >
                <ScanDocumentIcon
                  size={14}
                />

                <span className="ml-1.5">
                  Scan Document
                </span>
              </Button>

              <Button
                size="sm"
                onClick={() =>
                  openForm(
                    "Manual"
                  )
                }
              >
                <Plus className="mr-1.5 size-4" />
                Manual Add
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {formOpen && (
          <RecordForm
            key={`${recordType}-${initialSource}`}
            title={`Add ${title} Record`}
            recordType={
              recordType
            }
            company={company}
            records={allRecords}
            initialSource={
              initialSource
            }
            onCancel={() =>
              setFormOpen(false)
            }
            onSave={(record) => {
              onSave(record)
              setFormOpen(false)
            }}
          />
        )}

        {archiveTarget && (
          <ArchivePanel
            record={archiveTarget}
            onCancel={() =>
              setArchiveTarget(
                null
              )
            }
            onConfirm={(
              reason
            ) => {
              onArchive(
                archiveTarget.id,
                reason
              )

              setArchiveTarget(
                null
              )
            }}
          />
        )}

        {activeRecords.length >
          0 && (
          <div className="hidden grid-cols-12 gap-4 border-b bg-muted/10 p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground md:grid">
            <div className="col-span-3">
              Coverage / Record
            </div>

            <div className="col-span-3">
              Carrier / Provider
            </div>

            <div className="col-span-2">
              Limit / Amount
            </div>

            <div className="col-span-2">
              Dates
            </div>

            <div className="col-span-2 text-right">
              Status
            </div>
          </div>
        )}

        {activeRecords.length ===
        0 ? (
          <div className="p-10 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {icon}
            </div>

            <p className="mt-3 text-sm font-medium">
              No active records
            </p>

            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Scan the source document
              for assisted extraction or
              enter the record manually.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {activeRecords.map(
              (record) => (
                <RecordRow
                  key={record.id}
                  record={record}
                  onArchive={
                    setArchiveTarget
                  }
                />
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* =========================================================
   SUMMARY CARD
========================================================= */

function SummaryCard({
  label,
  value,
  status,
}: {
  label: string
  value: number
  status: RecordStatus
}) {
  const classes =
    getStatusClasses(status)

  return (
    <Card
      className={
        status === "Archived"
          ? ""
          : classes.row
      }
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {label}
          </p>

          <StatusDot
            status={status}
          />
        </div>

        <p className="mt-2 text-2xl font-bold">
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

function StatusDot({
  status,
}: {
  status: RecordStatus
}) {
  if (status === "Healthy") {
    return (
      <CheckCircle2 className="size-4 text-emerald-600" />
    )
  }

  if (status === "Watch") {
    return (
      <CalendarClock className="size-4 text-amber-600" />
    )
  }

  if (status === "Urgent") {
    return (
      <AlertTriangle className="size-4 text-red-500" />
    )
  }

  if (status === "Critical") {
    return (
      <AlertTriangle className="size-4 text-red-800" />
    )
  }

  if (status === "Expired") {
    return (
      <XCircle className="size-4 text-red-950" />
    )
  }

  return (
    <Archive className="size-4 text-muted-foreground" />
  )
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function InsurancePage() {
  const params = useParams()
  const router = useRouter()

  const companyId =
    params.id as string

  const [company, setCompany] =
    useState<Company | null>(null)

  const [records, setRecords] =
    useState<InsuranceRecord[]>(
      []
    )

  const [settings, setSettings] =
    useState<SystemSettings>({
      version: 1,
      expiryRules:
        DEFAULT_EXPIRY_RULES,
    })

  const [loading, setLoading] =
    useState(true)

  const storageKey =
    `tes_company_insurance_${companyId}`

  /* =======================================================
     LOAD
  ======================================================= */

  useEffect(() => {
    try {
      const savedCompanies =
        JSON.parse(
          localStorage.getItem(
            "tes_companies"
          ) || "[]"
        )

      const found =
        savedCompanies.find(
          (item: Company) =>
            item.id === companyId
        )

      setCompany(
        found || null
      )

      const savedRecords =
        JSON.parse(
          localStorage.getItem(
            storageKey
          ) || "[]"
        )

      /*
        Backward compatibility:
        Existing records used "company" for provider.
        We normalize them without destroying the stored data.
      */

      const migrated =
        savedRecords.map(
          (
            record: any
          ): InsuranceRecord => ({
            ...record,

            family:
              record.family ||
              inferFamily(
                record.type
              ),

            provider:
              record.provider ||
              record.company ||
              "",

            ocrStatus:
              record.ocrStatus ||
              (record.source ===
              "OCR"
                ? "Needs Review"
                : "Not Used"),
          })
        )

      setRecords(migrated)

      setSettings(
        loadSystemSettings()
      )
    } catch (error) {
      console.error(
        "Unable to load insurance page:",
        error
      )
    } finally {
      setLoading(false)
    }
  }, [companyId, storageKey])

  /* =======================================================
     SYNC SETTINGS IF CHANGED ELSEWHERE
  ======================================================= */

  useEffect(() => {
    const handleStorage = (
      event: StorageEvent
    ) => {
      if (
        event.key ===
        SETTINGS_STORAGE_KEY
      ) {
        setSettings(
          loadSystemSettings()
        )
      }
    }

    window.addEventListener(
      "storage",
      handleStorage
    )

    return () =>
      window.removeEventListener(
        "storage",
        handleStorage
      )
  }, [])

  /* =======================================================
     SAVE RECORDS
  ======================================================= */

  useEffect(() => {
    if (!loading) {
      localStorage.setItem(
        storageKey,
        JSON.stringify(records)
      )
    }
  }, [
    records,
    loading,
    storageKey,
  ])

  /* =======================================================
     NORMALIZED STATUS
  ======================================================= */

  const normalizedRecords =
    useMemo(() => {
      return records.map(
        (record) => ({
          ...record,

          status:
            getRecordStatus(
              record.expiry,
              settings.expiryRules,
              Boolean(
                record.archivedAt
              ) ||
                record.status ===
                  "Archived"
            ),
        })
      )
    }, [
      records,
      settings.expiryRules,
    ])

  /* =======================================================
     SUMMARY
  ======================================================= */

  const summary = useMemo(() => {
    const count = (
      status: RecordStatus
    ) =>
      normalizedRecords.filter(
        (record) =>
          record.status ===
          status
      ).length

    return {
      healthy:
        count("Healthy"),

      watch: count("Watch"),

      urgent: count("Urgent"),

      critical:
        count("Critical"),

      expired:
        count("Expired"),

      archived:
        count("Archived"),
    }
  }, [normalizedRecords])

  /* =======================================================
     SAVE
  ======================================================= */

  const saveRecord = (
    draft: RecordDraft
  ) => {
    /*
      Second duplicate guard.
      UI validation is never the only guard.
    */

    const duplicate =
      findDuplicatePolicy(
        normalizedRecords,
        draft.number
      )

    if (duplicate) {
      window.alert(
        `Duplicate identifier detected. ${duplicate.type} already uses ${duplicate.number}.`
      )
      return
    }

    const now =
      new Date().toISOString()

    const newRecord: InsuranceRecord =
      {
        ...draft,

        id: `${companyId}-INS-${crypto.randomUUID()}`,

        createdAt: now,

        status:
          getRecordStatus(
            draft.expiry,
            settings.expiryRules
          ),
      }

    setRecords((current) => [
      newRecord,
      ...current,
    ])

    /*
      MASTER REGISTER INTEGRATION POINT

      Future centralized audit service should receive:

      {
        event: "INSURANCE_RECORD_CREATED",
        companyId,
        recordId: newRecord.id,
        actor,
        role,
        timestamp,
        source,
        documentId
      }

      Do not build a separate insurance-only ledger.
    */
  }

  /* =======================================================
     ARCHIVE
  ======================================================= */

  const archiveRecord = (
    id: string,
    reason: string
  ) => {
    const now =
      new Date().toISOString()

    setRecords((current) =>
      current.map((record) =>
        record.id === id
          ? {
              ...record,

              status:
                "Archived",

              archivedAt: now,

              archivedBy:
                "Current User",

              archiveReason:
                reason,

              updatedAt: now,
            }
          : record
      )
    )

    /*
      MASTER REGISTER INTEGRATION POINT

      Future event:

      INSURANCE_RECORD_ARCHIVED

      with actor, role, timestamp, record ID,
      reason and company ID.
    */
  }

  /* =======================================================
     RENDER STATES
  ======================================================= */

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center p-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-10 text-center">
        <Building2 className="size-10 text-muted-foreground/40" />

        <div>
          <h2 className="text-lg font-semibold">
            Company Not Found
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            The requested company
            record could not be loaded.
          </p>
        </div>

        <Button
          variant="outline"
          onClick={() =>
            router.push(
              "/companies"
            )
          }
        >
          <ArrowLeft className="mr-2 size-4" />
          Return to Companies
        </Button>
      </div>
    )
  }

  const transportationRecords =
    normalizedRecords.filter(
      (record) =>
        record.family ===
        "transportation"
    )

  const workersRecords =
    normalizedRecords.filter(
      (record) =>
        record.family ===
        "workers"
    )

  const bondRecords =
    normalizedRecords.filter(
      (record) =>
        record.family ===
        "bond"
    )

  return (
    <div className="flex max-w-7xl flex-col gap-6 pb-12">
      {/* ===================================================
          HEADER
      =================================================== */}

      <div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() =>
              router.push(
                `/companies/${company.id}/profile`
              )
            }
          >
            <ArrowLeft className="size-4" />
          </Button>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Insurance & Bonds
            </h1>

            <p className="mt-0.5 text-sm text-muted-foreground">
              {company.name}{" "}
              <span className="font-mono text-xs">
                ({company.id})
              </span>
            </p>
          </div>
        </div>

        {/* COMPANY SOURCE CONTEXT */}

        <div className="mt-5 rounded-xl border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Registered Origin
              </p>

              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                <Building2 className="size-3.5 text-primary" />

                {company.regCorpState ||
                  "Unknown"}
                ,{" "}
                {company.regCorpCountry ||
                  "Unknown"}
              </p>
            </div>

            <div className="hidden h-8 w-px bg-border sm:block" />

            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Operating Region
              </p>

              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                <CheckCircle2 className="size-3.5 text-primary" />

                {company.region ||
                  "Not specified"}
              </p>
            </div>

            <div className="hidden h-8 w-px bg-border lg:block" />

            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Renewal Rules
              </p>

              <p className="mt-1 text-xs font-medium text-muted-foreground">
                Portal Settings
                controls expiry
                classification
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================
          STATUS SUMMARY
      =================================================== */}

      <div>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">
              Renewal Position
            </h2>

            <p className="mt-1 text-xs text-muted-foreground">
              Live classification
              based on the central
              Portal Settings rules.
            </p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() =>
              setSettings(
                loadSystemSettings()
              )
            }
          >
            <RefreshCcw className="mr-1.5 size-3.5" />
            Refresh Rules
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SummaryCard
            label="Healthy"
            value={
              summary.healthy
            }
            status="Healthy"
          />

          <SummaryCard
            label="Watch"
            value={summary.watch}
            status="Watch"
          />

          <SummaryCard
            label="Urgent"
            value={
              summary.urgent
            }
            status="Urgent"
          />

          <SummaryCard
            label="Critical"
            value={
              summary.critical
            }
            status="Critical"
          />

          <SummaryCard
            label="Expired"
            value={
              summary.expired
            }
            status="Expired"
          />

          <SummaryCard
            label="Archived"
            value={
              summary.archived
            }
            status="Archived"
          />
        </div>
      </div>

      {/* ===================================================
          TRANSPORTATION
      =================================================== */}

      <InsuranceSection
        title="Transportation Insurance"
        description="Auto liability, general liability, motor truck cargo and physical damage coverage."
        icon={
          <ShieldCheck className="size-4 text-primary" />
        }
        recordType="transportation"
        company={company}
        records={
          transportationRecords
        }
        allRecords={
          normalizedRecords
        }
        onSave={saveRecord}
        onArchive={
          archiveRecord
        }
      />

      {/* ===================================================
          WORKERS
      =================================================== */}

      <InsuranceSection
        title="Workers Insurance"
        description="Workers compensation, WCB / WSIB and occupational accident coverage."
        icon={
          <HardHat className="size-4 text-primary" />
        }
        recordType="workers"
        company={company}
        records={
          workersRecords
        }
        allRecords={
          normalizedRecords
        }
        onSave={saveRecord}
        onArchive={
          archiveRecord
        }
      />

      {/* ===================================================
          BONDS
      =================================================== */}

      <InsuranceSection
        title="Surety Bonds"
        description="Customs bonds, freight broker bonds and other surety guarantees."
        icon={
          <FileKey2 className="size-4 text-primary" />
        }
        recordType="bond"
        company={company}
        records={
          bondRecords
        }
        allRecords={
          normalizedRecords
        }
        onSave={saveRecord}
        onArchive={
          archiveRecord
        }
      />

      {/* ===================================================
          INTEGRITY
      =================================================== */}

      <Card className="border-dashed bg-muted/10">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <History className="size-4" />
            </div>

            <div>
              <p className="text-xs font-semibold">
                Compliance record
                integrity
              </p>

              <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
                Insurance records are
                retained as historical
                compliance information.
                Records are archived
                rather than deleted.
                Original evidence remains
                associated with the
                record, and AI-assisted
                extraction never silently
                changes authoritative
                compliance information.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* =========================================================
   LEGACY FAMILY INFERENCE

   Allows existing localStorage records from the previous
   Insurance page to continue appearing after this upgrade.
========================================================= */

function inferFamily(
  type?: string
): RecordFamily {
  if (
    [
      "WSIB",
      "WCB",
      "Workers Compensation",
      "Occupational Accident",
    ].includes(type || "")
  ) {
    return "workers"
  }

  if (
    [
      "US Customs Continuous",
      "Freight Broker BMC-84",
      "Performance Bond",
    ].includes(type || "")
  ) {
    return "bond"
  }

  return "transportation"
}
