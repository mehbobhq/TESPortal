"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  Building2,
  Plus,
  CheckCircle2,
  ShieldCheck,
  HardHat,
  FileKey2,
  FileText,
  Archive,
  CalendarClock,
  AlertTriangle,
  XCircle,
  Eye,
  Upload,
  Loader2,
  Check,
  RotateCcw,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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

type RecordStatus = "Active" | "Expiring Soon" | "Expired" | "Archived"
type SourceType = "Manual" | "OCR"

type InsuranceRecord = {
  id: string
  type: string
  number: string
  company: string
  broker?: string
  limits?: string
  principal?: string
  amount?: string
  effective: string
  expiry?: string
  status: RecordStatus
  source: SourceType
  documentName?: string
  documentUrl?: string
  ocrStatus?: "Not Used" | "Ready" | "Processing" | "Needs Review" | "Verified"
  createdAt: string
  archivedAt?: string
}

type Company = {
  id: string
  name: string
  region?: string
  regCorpState?: string
  regCorpCountry?: string
}

/* =========================================================
   STANDARD TES OCR ICON
========================================================= */

function ScanDocumentIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-0">
        <span className="absolute left-0 top-0 h-[35%] w-[35%] border-l-[1.5px] border-t-[1.5px] border-current rounded-tl-[2px]" />
        <span className="absolute right-0 top-0 h-[35%] w-[35%] border-r-[1.5px] border-t-[1.5px] border-current rounded-tr-[2px]" />
        <span className="absolute left-0 bottom-0 h-[35%] w-[35%] border-l-[1.5px] border-b-[1.5px] border-current rounded-bl-[2px]" />
        <span className="absolute right-0 bottom-0 h-[35%] w-[35%] border-r-[1.5px] border-b-[1.5px] border-current rounded-br-[2px]" />
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
   STATUS HELPERS
========================================================= */

function getRecordStatus(
  effective?: string,
  expiry?: string,
  archived = false
): RecordStatus {
  if (archived) return "Archived"

  if (expiry) {
    const today = new Date()
    const expiryDate = new Date(`${expiry}T23:59:59`)
    const diff =
      expiryDate.getTime() - today.getTime()

    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))

    if (days < 0) return "Expired"
    if (days <= 60) return "Expiring Soon"
  }

  return "Active"
}

function statusBadge(status: RecordStatus) {
  switch (status) {
    case "Active":
      return (
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          <CheckCircle2 className="mr-1 size-3" />
          Active
        </Badge>
      )

    case "Expiring Soon":
      return (
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
          <CalendarClock className="mr-1 size-3" />
          Expiring Soon
        </Badge>
      )

    case "Expired":
      return (
        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
          <XCircle className="mr-1 size-3" />
          Expired
        </Badge>
      )

    case "Archived":
      return (
        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
          <Archive className="mr-1 size-3" />
          Archived
        </Badge>
      )
  }
}

/* =========================================================
   OCR DOCUMENT PANEL
========================================================= */

function OCRDocumentPanel({
  title,
  description,
  onFileSelected,
}: {
  title: string
  description: string
  onFileSelected: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [reviewReady, setReviewReady] = useState(false)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const handleFile = (selected: File | null) => {
    if (!selected) return

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }

    const url = URL.createObjectURL(selected)

    setFile(selected)
    setPreviewUrl(url)
    setReviewReady(false)

    onFileSelected(selected)
  }

  const runOCR = async () => {
    if (!file) return

    setProcessing(true)

    /*
      ======================================================
      REAL OCR INTEGRATION POINT

      Replace this section with the TES OCR API.

      Expected lifecycle:

      upload document
        ↓
      document processing
        ↓
      OCR extraction
        ↓
      confidence scoring
        ↓
      extracted fields returned
        ↓
      human review
        ↓
      verified record
      ======================================================
    */

    await new Promise((resolve) => setTimeout(resolve, 1200))

    setProcessing(false)
    setReviewReady(true)
  }

  return (
    <div className="rounded-xl border bg-background overflow-hidden">
      <div className="p-4 border-b bg-muted/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ScanDocumentIcon size={17} />
              </div>

              <div>
                <h4 className="text-sm font-semibold">{title}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {description}
                </p>
              </div>
            </div>
          </div>

          {file && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => {
                setFile(null)
                setReviewReady(false)

                if (previewUrl) {
                  URL.revokeObjectURL(previewUrl)
                }

                setPreviewUrl(null)
                onFileSelected(null)
              }}
            >
              <XCircle className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {!file ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full p-8 flex flex-col items-center justify-center text-center hover:bg-muted/20 transition-colors"
        >
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
            <ScanDocumentIcon size={23} />
          </div>

          <p className="text-sm font-medium">
            Upload document for OCR
          </p>

          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            PDF, JPG or PNG. The original document remains attached
            to the compliance record.
          </p>

          <div className="mt-4 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium">
            <Upload className="size-3.5" />
            Browse Files
          </div>
        </button>
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)] min-h-[360px]">
          {/* DOCUMENT PREVIEW */}
          <div className="border-b lg:border-b-0 lg:border-r bg-muted/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Original Document
                </p>
                <p className="text-xs truncate max-w-[300px] mt-1">
                  {file.name}
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
              >
                <Eye className="mr-1.5 size-3.5" />
                Full View
              </Button>
            </div>

            <div className="h-[280px] rounded-lg border bg-background overflow-hidden flex items-center justify-center">
              {file.type === "application/pdf" ? (
                <iframe
                  src={previewUrl || undefined}
                  className="w-full h-full"
                  title="Uploaded insurance document"
                />
              ) : (
                <img
                  src={previewUrl || undefined}
                  alt="Uploaded insurance document"
                  className="max-h-full max-w-full object-contain"
                />
              )}
            </div>
          </div>

          {/* OCR STATUS */}
          <div className="p-5 flex flex-col">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Document Processing
            </p>

            <div className="mt-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <Check className="size-3.5" />
                </div>

                <div>
                  <p className="text-sm font-medium">Document uploaded</p>
                  <p className="text-xs text-muted-foreground">
                    Original file is available for review.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex size-6 items-center justify-center rounded-full ${
                    processing
                      ? "bg-blue-100 text-blue-700"
                      : reviewReady
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {processing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : reviewReady ? (
                    <Check className="size-3.5" />
                  ) : (
                    <ScanDocumentIcon size={13} />
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium">
                    {processing
                      ? "Processing document..."
                      : reviewReady
                        ? "Extraction complete"
                        : "Ready for OCR"}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    {reviewReady
                      ? "Extracted information is ready for human review."
                      : "AI will assist with field extraction. Nothing is silently saved."}
                  </p>
                </div>
              </div>
            </div>

            {!reviewReady && (
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
                    <ScanDocumentIcon size={15} />
                    <span className="ml-2">Run OCR</span>
                  </>
                )}
              </Button>
            )}

            {reviewReady && (
              <div className="mt-auto rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 text-amber-700 shrink-0" />

                  <div>
                    <p className="text-xs font-semibold text-amber-900">
                      Human verification required
                    </p>
                    <p className="text-xs text-amber-800 mt-1">
                      Review the extracted fields against the original
                      document before saving this compliance record.
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
        onChange={(e) => handleFile(e.target.files?.[0] || null)}
      />
    </div>
  )
}

/* =========================================================
   RECORD FORM
========================================================= */

function RecordForm({
  title,
  recordType,
  company,
  onSave,
  onCancel,
}: {
  title: string
  recordType: "transportation" | "workers" | "bond"
  company: Company
  onSave: (
    record: Omit<InsuranceRecord, "id" | "createdAt" | "status">
  ) => void
  onCancel: () => void
}) {
  const [source, setSource] = useState<SourceType>("Manual")
  const [document, setDocument] = useState<File | null>(null)

  const [type, setType] = useState("")
  const [number, setNumber] = useState("")
  const [provider, setProvider] = useState("")
  const [broker, setBroker] = useState("")
  const [limits, setLimits] = useState("")
  const [principal, setPrincipal] = useState(company.name)
  const [amount, setAmount] = useState("")
  const [effective, setEffective] = useState("")
  const [expiry, setExpiry] = useState("")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()

    onSave({
      type,
      number,
      company: provider,
      broker,
      limits,
      principal,
      amount,
      effective,
      expiry,
      source,
      documentName: document?.name,
      documentUrl: document ? URL.createObjectURL(document) : undefined,
      ocrStatus:
        source === "OCR"
          ? "Needs Review"
          : "Not Used",
    })
  }

  return (
    <form
      onSubmit={submit}
      className="border-b bg-primary/[0.025]"
    >
      <div className="p-5 border-b">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-sm">{title}</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {source === "OCR"
                ? "Review extracted information before creating the compliance record."
                : "Enter the record information manually."}
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

        <div className="mt-4 flex rounded-lg border bg-background p-1 w-fit">
          <button
            type="button"
            onClick={() => setSource("Manual")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              source === "Manual"
                ? "bg-muted"
                : "text-muted-foreground"
            }`}
          >
            Manual Entry
          </button>

          <button
            type="button"
            onClick={() => setSource("OCR")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              source === "OCR"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <ScanDocumentIcon size={13} />
              Scan Document
            </span>
          </button>
        </div>
      </div>

      {source === "OCR" && (
        <div className="p-5 border-b">
          <OCRDocumentPanel
            title="Source Document"
            description="Upload the original insurance document. AI assists with extraction; the original remains the source of truth."
            onFileSelected={setDocument}
          />
        </div>
      )}

      <div className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>Record Type *</Label>

            <Select
              value={type}
              onValueChange={setType}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>

              <SelectContent>
                {recordType === "transportation" && (
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

                {recordType === "workers" && (
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

                {recordType === "bond" && (
                  <>
                    <SelectItem value="US Customs Continuous">
                      US Customs Continuous
                    </SelectItem>
                    <SelectItem value="Freight Broker BMC-84">
                      Freight Broker BMC-84
                    </SelectItem>
                    <SelectItem value="Performance Bond">
                      Performance Bond
                    </SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>
              {recordType === "bond"
                ? "Bond Number"
                : "Policy / Account Number"}{" "}
              *
            </Label>

            <Input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              required
            />
          </div>

          {recordType === "bond" ? (
            <div className="space-y-2">
              <Label>Bond Amount</Label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="$50,000"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>
                {recordType === "workers"
                  ? "Account / Coverage"
                  : "Coverage Limits"}
              </Label>

              <Input
                value={limits}
                onChange={(e) => setLimits(e.target.value)}
                placeholder={
                  recordType === "transportation"
                    ? "$1,000,000"
                    : "Optional"
                }
              />
            </div>
          )}

          <div className="space-y-2 sm:col-span-2">
            <Label>
              {recordType === "workers"
                ? "Issuing Board / Carrier"
                : recordType === "bond"
                  ? "Surety Company"
                  : "Insurance Carrier"}{" "}
              *
            </Label>

            <Input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              required
            />
          </div>

          {recordType === "transportation" && (
            <div className="space-y-2">
              <Label>Broker</Label>
              <Input
                value={broker}
                onChange={(e) => setBroker(e.target.value)}
              />
            </div>
          )}

          {recordType === "bond" && (
            <div className="space-y-2">
              <Label>Principal Name</Label>
              <Input
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Effective Date *</Label>
            <Input
              type="date"
              value={effective}
              onChange={(e) => setEffective(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>
              Expiry Date
              {recordType !== "bond" && " *"}
            </Label>

            <Input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              required={recordType !== "bond"}
            />
          </div>
        </div>

        {source === "OCR" && (
          <div className="mt-5 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-4 text-amber-600 mt-0.5" />

              <div>
                <p className="text-xs font-semibold">
                  Verify before saving
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  OCR is assistive only. The extracted values must be
                  checked against the original document before becoming
                  authoritative compliance data.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>

          <Button type="submit">
            <Check className="mr-2 size-4" />
            Save Record
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
  onArchive: (id: string) => void
}) {
  return (
    <div
      className={`group grid gap-4 p-4 transition-colors hover:bg-muted/20 ${
        record.status === "Archived"
          ? "opacity-60"
          : ""
      } md:grid-cols-12`}
    >
      <div className="md:col-span-3">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm">
            {record.type}
          </p>

          {record.source === "OCR" && (
            <Badge
              variant="outline"
              className="text-[9px] px-1.5 py-0"
            >
              OCR
            </Badge>
          )}
        </div>

        <p className="font-mono text-[10px] text-muted-foreground mt-1">
          {record.number}
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="text-sm">
          {record.company || "—"}
        </p>

        {record.broker && (
          <p className="text-xs text-muted-foreground mt-1">
            Broker: {record.broker}
          </p>
        )}
      </div>

      <div className="md:col-span-2">
        {record.limits && (
          <p className="font-mono text-xs">
            {record.limits}
          </p>
        )}

        {record.amount && (
          <p className="font-mono text-xs">
            {record.amount}
          </p>
        )}
      </div>

      <div className="md:col-span-2 text-xs">
        <p className="text-muted-foreground">
          Effective: {record.effective || "—"}
        </p>

        <p
          className={`mt-1 ${
            record.status === "Expired"
              ? "text-red-600 font-semibold"
              : record.status === "Expiring Soon"
                ? "text-amber-700 font-semibold"
                : ""
          }`}
        >
          Expiry: {record.expiry || "Continuous"}
        </p>
      </div>

      <div className="md:col-span-2 flex md:justify-end items-center gap-2">
        {statusBadge(record.status)}

        {record.status !== "Archived" && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="Archive record"
            onClick={() => onArchive(record.id)}
          >
            <Archive className="size-4" />
          </Button>
        )}
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
  recordType,
  onSave,
  onArchive,
}: {
  title: string
  description: string
  icon: React.ReactNode
  records: InsuranceRecord[]
  recordType: "transportation" | "workers" | "bond"
  onSave: (
    record: Omit<InsuranceRecord, "id" | "createdAt" | "status">
  ) => void
  onArchive: (id: string) => void
}) {
  const [formOpen, setFormOpen] = useState(false)

  const activeRecords = records.filter(
    (r) => r.status !== "Archived"
  )

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/20 py-4 border-b">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              {icon}
              {title}
            </CardTitle>

            <CardDescription className="text-xs mt-1">
              {description}
            </CardDescription>
          </div>

          {!formOpen && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFormOpen(true)}
              >
                <ScanDocumentIcon size={14} />
                <span className="ml-1.5">
                  Scan Document
                </span>
              </Button>

              <Button
                size="sm"
                onClick={() => setFormOpen(true)}
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
            title={`Add ${title} Record`}
            recordType={recordType}
            company={records[0]?.principal ? {
              id: "",
              name: records[0].principal || "",
            } : {
              id: "",
              name: "",
            }}
            onCancel={() => setFormOpen(false)}
            onSave={(record) => {
              onSave(record)
              setFormOpen(false)
            }}
          />
        )}

        {activeRecords.length > 0 && (
          <div className="hidden md:grid grid-cols-12 gap-4 p-3 border-b bg-muted/10 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <div className="col-span-3">Coverage / Record</div>
            <div className="col-span-3">Carrier / Provider</div>
            <div className="col-span-2">Limits / Amount</div>
            <div className="col-span-2">Dates</div>
            <div className="col-span-2 text-right">Status / Actions</div>
          </div>
        )}

        {activeRecords.length === 0 ? (
          <div className="p-10 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {icon}
            </div>

            <p className="mt-3 text-sm font-medium">
              No active records
            </p>

            <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
              Add the record manually or scan the supporting
              document to establish the compliance record.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {activeRecords.map((record) => (
              <RecordRow
                key={record.id}
                record={record}
                onArchive={onArchive}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function InsurancePage() {
  const params = useParams()
  const router = useRouter()

  const [company, setCompany] =
    useState<Company | null>(null)

  const [loading, setLoading] = useState(true)

  const [records, setRecords] =
    useState<InsuranceRecord[]>([])

  const storageKey = `tes_company_insurance_${params.id}`

  /* ---------------------------------------------
     LOAD COMPANY + RECORDS
  --------------------------------------------- */

  useEffect(() => {
    const id = params.id as string

    const savedCompanies = JSON.parse(
      localStorage.getItem("tes_companies") || "[]"
    )

    const found = savedCompanies.find(
      (c: Company) => c.id === id
    )

    setCompany(found || null)

    const savedRecords = JSON.parse(
      localStorage.getItem(storageKey) || "[]"
    )

    setRecords(savedRecords)

    setLoading(false)
  }, [params.id, storageKey])

  /* ---------------------------------------------
     PERSIST RECORDS
  --------------------------------------------- */

  useEffect(() => {
    if (!loading) {
      localStorage.setItem(
        storageKey,
        JSON.stringify(records)
      )
    }
  }, [records, loading, storageKey])

  /* ---------------------------------------------
     DERIVE CURRENT STATUS
  --------------------------------------------- */

  const normalizedRecords = useMemo(() => {
    return records.map((record) => ({
      ...record,
      status: getRecordStatus(
        record.effective,
        record.expiry,
        record.status === "Archived"
      ),
    }))
  }, [records])

  /* ---------------------------------------------
     SUMMARY
  --------------------------------------------- */

  const summary = useMemo(() => {
    return {
      active: normalizedRecords.filter(
        (r) => r.status === "Active"
      ).length,

      expiring: normalizedRecords.filter(
        (r) => r.status === "Expiring Soon"
      ).length,

      expired: normalizedRecords.filter(
        (r) => r.status === "Expired"
      ).length,

      archived: normalizedRecords.filter(
        (r) => r.status === "Archived"
      ).length,
    }
  }, [normalizedRecords])

  /* ---------------------------------------------
     SAVE RECORD
  --------------------------------------------- */

  const saveRecord = (
    record: Omit<InsuranceRecord, "id" | "createdAt" | "status">
  ) => {
    const newRecord: InsuranceRecord = {
      ...record,
      id: `${params.id}-INS-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      status: getRecordStatus(
        record.effective,
        record.expiry
      ),
    }

    setRecords((current) => [
      newRecord,
      ...current,
    ])
  }

  /* ---------------------------------------------
     ARCHIVE
  --------------------------------------------- */

  const archiveRecord = (id: string) => {
    setRecords((current) =>
      current.map((record) =>
        record.id === id
          ? {
              ...record,
              status: "Archived",
              archivedAt: new Date().toISOString(),
            }
          : record
      )
    )
  }

  if (loading) {
    return (
      <div className="p-10 flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="p-10 text-center">
        <p className="font-semibold">
          Company Not Found
        </p>

        <Button
          className="mt-4"
          variant="outline"
          onClick={() => router.push("/companies")}
        >
          Return to Companies
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 pb-12 max-w-6xl">
      {/* =========================================
          HEADER
      ========================================= */}

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

            <p className="text-sm text-muted-foreground mt-0.5">
              {company.name}{" "}
              <span className="font-mono text-xs">
                ({company.id})
              </span>
            </p>
          </div>
        </div>

        {/* COMPANY CONTEXT */}
        <div className="mt-5 rounded-xl border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Registered Origin
              </p>

              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                <Building2 className="size-3.5 text-primary" />
                {company.regCorpState || "Unknown"},{" "}
                {company.regCorpCountry || "Unknown"}
              </p>
            </div>

            <div className="hidden sm:block h-8 w-px bg-border" />

            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Operating Region
              </p>

              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                <CheckCircle2 className="size-3.5 text-primary" />
                {company.region || "Not specified"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================
          COMPLIANCE SUMMARY
      ========================================= */}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Active
              </p>

              <CheckCircle2 className="size-4 text-emerald-600" />
            </div>

            <p className="text-2xl font-bold mt-2">
              {summary.active}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Expiring Soon
              </p>

              <CalendarClock className="size-4 text-amber-600" />
            </div>

            <p className="text-2xl font-bold mt-2">
              {summary.expiring}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Expired
              </p>

              <XCircle className="size-4 text-red-600" />
            </div>

            <p className="text-2xl font-bold mt-2">
              {summary.expired}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Archived
              </p>

              <Archive className="size-4 text-muted-foreground" />
            </div>

            <p className="text-2xl font-bold mt-2">
              {summary.archived}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* =========================================
          TRANSPORTATION
      ========================================= */}

      <InsuranceSection
        title="Transportation Insurance"
        description="Auto liability, general liability, cargo and physical damage coverage."
        icon={
          <ShieldCheck className="size-4 text-primary" />
        }
        recordType="transportation"
        records={normalizedRecords.filter((r) =>
          [
            "Auto Liability",
            "General Liability",
            "Motor Truck Cargo",
            "Physical Damage",
          ].includes(r.type)
        )}
        onSave={saveRecord}
        onArchive={archiveRecord}
      />

      {/* =========================================
          WORKERS
      ========================================= */}

      <InsuranceSection
        title="Workers Insurance"
        description="Workers compensation and occupational accident coverage."
        icon={
          <HardHat className="size-4 text-primary" />
        }
        recordType="workers"
        records={normalizedRecords.filter((r) =>
          [
            "WSIB",
            "WCB",
            "Workers Compensation",
            "Occupational Accident",
          ].includes(r.type)
        )}
        onSave={saveRecord}
        onArchive={archiveRecord}
      />

      {/* =========================================
          SURETY
      ========================================= */}

      <InsuranceSection
        title="Surety Bonds"
        description="Customs bonds, freight broker bonds and performance guarantees."
        icon={
          <FileKey2 className="size-4 text-primary" />
        }
        recordType="bond"
        records={normalizedRecords.filter((r) =>
          [
            "US Customs Continuous",
            "Freight Broker BMC-84",
            "Performance Bond",
          ].includes(r.type)
        )}
        onSave={saveRecord}
        onArchive={archiveRecord}
      />

      {/* =========================================
          FOOTER NOTE
      ========================================= */}

      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <RotateCcw className="size-4 text-muted-foreground mt-0.5" />

          <div>
            <p className="text-xs font-semibold">
              Compliance record integrity
            </p>

            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Insurance records are retained as historical
              compliance information. Records are archived rather
              than deleted. AI-assisted extraction never silently
              changes authoritative compliance data.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
