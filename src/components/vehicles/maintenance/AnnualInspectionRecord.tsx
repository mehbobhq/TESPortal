"use client"

import * as React from "react"
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronUp,
  FileText,
  Filter,
  Link2,
  MoreVertical,
  Pencil,
  Search,
  Upload,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"

export type InspectionResultValue = "PASS" | "FAIL" | "NOT_APPLICABLE"
export type EvidenceRequirementStatus = "VERIFIED" | "MISSING" | "REVIEW_REQUIRED"

export interface AnnualInspectionDocument {
  id: string
  title: string
  fileName: string
  mimeType: string
  sizeLabel: string
  uploadedAtLabel: string
  verificationStatus: "VERIFIED" | "REVIEW_REQUIRED"
}

/**
 * One item represents one required annual-inspection PERIOD, not one file.
 * A certificate and a detailed inspection report may both support the same period.
 */
export interface AnnualInspectionPeriodRequirement {
  id: string
  label: string
  annualInspectionRecordId: string | null
  evidenceDocumentIds: string[]
  status: EvidenceRequirementStatus
}

export interface AnnualInspectionComponentResult {
  id: string
  system: string
  component: string
  result: InspectionResultValue
  measurementOrFinding?: string
  correction?: string
  biNodeId: string
  biNodeLabel: string
}

export interface LinkedParty {
  id: string
  type: "SERVICE_PROVIDER" | "CONTACT" | "ORGANIZATION"
  label: string
  subtitle: string
  sourceRole: string
}

export interface AnnualInspectionActivity {
  id: string
  title: string
  description: string
  occurredAtLabel: string
  actorLabel: string
}

export interface AnnualInspectionRecordModel {
  id: string
  vehicleId: string
  unitNumber: string
  vehicleLabel: string
  inspectionType: string
  jurisdiction: string
  inspectionProgram: string
  inspectionDateLabel: string
  expiryDateLabel: string
  daysRemaining: number
  certificateNumber?: string
  result: "PASSED" | "FAILED"
  odometerLabel?: string
  reviewMethodLabel: string
  createdAtLabel: string
  vehicleIdentityVerified: boolean
  documents: AnnualInspectionDocument[]
  requiredPeriods: AnnualInspectionPeriodRequirement[]
  componentResults: AnnualInspectionComponentResult[]
  linkedParties: LinkedParty[]
  activity: AnnualInspectionActivity[]
}

export interface AnnualInspectionRecordProps {
  record: AnnualInspectionRecordModel
  onEdit?: () => void
  onArchive?: () => void
  onUploadEvidence?: () => void
  onVerifyAndAttachEvidence?: (values: AnnualInspectionReviewValues) => void
  onBackToList?: () => void
  onOpenEvidence?: (document: AnnualInspectionDocument) => void
  onOpenLinkedParty?: (party: LinkedParty) => void
  onOpenBiNode?: (result: AnnualInspectionComponentResult) => void
}

export interface AnnualInspectionReviewValues {
  inspectionType: string
  jurisdiction: string
  inspectionProgram: string
  inspectionDate: string
  expiryDate: string
  certificateNumber: string
  result: "PASSED" | "FAILED"
  odometer: string
  vehicleIdentity: string
  inspectionFacility: string
  technicianOrContact: string
  ownerOrOperator: string
}

type ReviewMode = "OCR_CREATE" | "EVIDENCE_ATTACH"
type AnnualInspectionReviewTextKey = Exclude<keyof AnnualInspectionReviewValues, "result">

export function calculateAnnualInspectionEvidenceCompleteness(
  requiredPeriods: AnnualInspectionPeriodRequirement[],
) {
  const required = requiredPeriods.length
  const completed = requiredPeriods.filter(
    (period) =>
      period.status === "VERIFIED" &&
      Boolean(period.annualInspectionRecordId) &&
      period.evidenceDocumentIds.length > 0,
  ).length

  return {
    completed,
    required,
    isComplete: required > 0 && completed === required,
    percentage: required === 0 ? 0 : Math.round((completed / required) * 100),
  }
}

function StatusDot({ className }: { className?: string }) {
  return <span className={cn("inline-block h-4 w-4 rounded-full border-2", className)} />
}

function ResultBadge({ value }: { value: InspectionResultValue }) {
  const label = value === "NOT_APPLICABLE" ? "N/A" : value
  return (
    <span
      className={cn(
        "inline-flex min-w-12 justify-center rounded-md px-2 py-1 text-xs font-bold",
        value === "PASS" && "bg-emerald-50 text-emerald-700",
        value === "FAIL" && "bg-red-50 text-red-700",
        value === "NOT_APPLICABLE" && "bg-slate-100 text-slate-600",
      )}
    >
      {label}
    </span>
  )
}

function RecordOverview({
  record,
  onEdit,
  onOpenLinkedParty,
}: Pick<AnnualInspectionRecordProps, "record" | "onEdit" | "onOpenLinkedParty">) {
  const values = [
    ["Inspection type", record.inspectionType],
    ["Jurisdiction", record.jurisdiction],
    ["Inspection program", record.inspectionProgram],
    ["Inspection date", record.inspectionDateLabel],
    ["Expiry date", record.expiryDateLabel],
    ["Certificate number", record.certificateNumber || "Not provided by source"],
    ["Result", record.result === "PASSED" ? "Passed" : "Failed"],
    ["Odometer", record.odometerLabel || "Not available on source"],
    ["Record ID", record.id],
  ]

  return (
    <div className="grid gap-4">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-blue-950/[0.03]">
        <header className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-base font-semibold text-[#0d2052]">Inspection details</h2>
          <button className="text-sm font-semibold text-[#075df5]" onClick={onEdit} type="button">
            Edit
          </button>
        </header>
        <dl className="grid grid-cols-1 px-4 pb-4 md:grid-cols-2 xl:grid-cols-3">
          {values.map(([label, value]) => (
            <div className="border-b border-slate-100 py-3 pr-4 last:border-b-0 xl:[&:nth-last-child(-n+3)]:border-b-0" key={label}>
              <dt className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
              <dd className="text-sm font-semibold text-[#122653]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-blue-950/[0.03]">
        <header className="px-4 pb-2 pt-4">
          <h2 className="text-base font-semibold text-[#0d2052]">People & organizations</h2>
        </header>
        <div className="grid grid-cols-1 gap-3 px-4 pb-4 md:grid-cols-2">
          {record.linkedParties.map((party) => (
            <article className="min-h-28 rounded-md border border-slate-200 p-3" key={party.id}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{party.sourceRole}</p>
              <button
                className="mt-2 text-left text-sm font-bold text-[#075df5] hover:underline"
                onClick={() => onOpenLinkedParty?.(party)}
                type="button"
              >
                {party.label} ↗
              </button>
              <p className="mt-1 text-xs leading-5 text-slate-500">{party.subtitle}</p>
            </article>
          ))}
          <article className="min-h-28 rounded-md border border-slate-200 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vehicle association</p>
            <p className="mt-2 text-sm font-bold text-[#122653]">
              {record.vehicleIdentityVerified ? "VIN matched" : "Human review required"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Identity fields validate the relationship to Vehicle Master and are not duplicated on this record.
            </p>
          </article>
        </div>
      </section>
    </div>
  )
}

function InspectionResults({
  record,
  onOpenBiNode,
}: Pick<AnnualInspectionRecordProps, "record" | "onOpenBiNode">) {
  const pass = record.componentResults.filter((item) => item.result === "PASS").length
  const fail = record.componentResults.filter((item) => item.result === "FAIL").length
  const notApplicable = record.componentResults.filter((item) => item.result === "NOT_APPLICABLE").length

  return (
    <div>
      <header className="mb-4">
        <h2 className="text-xl font-semibold text-[#0d2052]">Inspection Results</h2>
        <p className="mt-1 text-sm text-slate-500">Every result resolves to a canonical vehicle-component BI node.</p>
      </header>
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          [record.componentResults.length, "Components captured"],
          [pass, "Passed"],
          [fail, "Failed / corrected"],
          [notApplicable, "Not applicable"],
        ].map(([value, label]) => (
          <div className="rounded-md border border-slate-200 bg-white p-3" key={label}>
            <strong className="block text-xl text-[#0d2052]">{value}</strong>
            <span className="text-xs text-slate-500">{label}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-[900px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">System</th>
              <th className="px-4 py-3">Component</th>
              <th className="px-4 py-3">Result</th>
              <th className="px-4 py-3">Measurement / finding</th>
              <th className="px-4 py-3">Correction</th>
              <th className="px-4 py-3">BI node</th>
            </tr>
          </thead>
          <tbody>
            {record.componentResults.map((item) => (
              <tr className="border-t border-slate-100 text-[#2c467a]" key={item.id}>
                <td className="px-4 py-3 font-bold">{item.system}</td>
                <td className="px-4 py-3 font-semibold">{item.component}</td>
                <td className="px-4 py-3"><ResultBadge value={item.result} /></td>
                <td className="px-4 py-3">{item.measurementOrFinding || "—"}</td>
                <td className="px-4 py-3">{item.correction || "—"}</td>
                <td className="px-4 py-3">
                  <button
                    className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-bold text-[#075df5]"
                    onClick={() => onOpenBiNode?.(item)}
                    type="button"
                  >
                    <Link2 className="h-3.5 w-3.5" /> {item.biNodeLabel}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RecordInspector({
  record,
  onUploadEvidence,
  onOpenEvidence,
}: Pick<AnnualInspectionRecordProps, "record" | "onUploadEvidence" | "onOpenEvidence">) {
  const [tab, setTab] = React.useState<"documents" | "details" | "activity">("documents")
  const completeness = React.useMemo(
    () => calculateAnnualInspectionEvidenceCompleteness(record.requiredPeriods),
    [record.requiredPeriods],
  )
  const expiryNeedsReview = record.daysRemaining > 366

  return (
    <aside className="overflow-hidden border-l border-slate-200 bg-white xl:fixed xl:bottom-0 xl:right-0 xl:top-0 xl:w-[340px]">
      <header className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
        <h2 className="text-xl font-semibold text-[#071846]">Evidence</h2>
        <button className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-[#31538c]" type="button">
          <ChevronUp className="h-4 w-4" />
        </button>
      </header>

      <div className="grid grid-cols-3 border-b border-slate-200 px-2">
        {(["documents", "details", "activity"] as const).map((value) => (
          <button
            className={cn(
              "relative h-12 text-xs text-[#49628f]",
              tab === value && "font-bold text-[#075df5] after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:bg-[#075df5]",
            )}
            key={value}
            onClick={() => setTab(value)}
            type="button"
          >
            {value === "documents" ? `Documents (${record.documents.length})` : value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>

      <div className="max-h-[calc(100vh-113px)] overflow-y-auto p-3.5">
        {tab === "documents" && (
          <div>
            <button
              className="grid min-h-32 w-full place-items-center content-center gap-1.5 rounded-md border border-dashed border-blue-200 bg-[#fbfdff] text-[#102653]"
              onClick={onUploadEvidence}
              type="button"
            >
              <span className="grid h-9 w-9 place-items-center rounded-md bg-blue-50 text-[#075df5]"><Upload className="h-5 w-5" /></span>
              <strong className="text-xs">Upload evidence to this record</strong>
              <small className="text-[11px] leading-4 text-slate-500">Preview and verify before attachment<br />PDF, JPG, PNG (Max 10 MB)</small>
            </button>

            <div className="my-3 grid grid-cols-[1fr_38px] gap-2">
              <div className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs text-slate-500"><Search className="h-4 w-4" /> Search documents...</div>
              <button className="grid h-10 place-items-center rounded-md border border-slate-200 text-slate-500" type="button"><Filter className="h-4 w-4" /></button>
            </div>

            <div>
              {record.documents.map((document) => (
                <article className="grid grid-cols-[34px_1fr_18px] gap-2 border-b border-slate-100 py-3" key={document.id}>
                  <div className="grid h-9 w-8 place-items-center rounded bg-red-50 text-red-600"><FileText className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <button className="text-left text-xs font-bold leading-4 text-[#122653] hover:underline" onClick={() => onOpenEvidence?.(document)} type="button">
                      {document.title}
                    </button>
                    <p className="mt-1 text-[10px] text-slate-500">{document.uploadedAtLabel} · {document.sizeLabel}</p>
                    <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", document.verificationStatus === "VERIFIED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                      {document.verificationStatus === "VERIFIED" ? "○ Verified" : "Review required"}
                    </span>
                  </div>
                  <button className="text-[#244b8d]" type="button"><MoreVertical className="h-4 w-4" /></button>
                </article>
              ))}
            </div>

            <div className={cn("mt-4 rounded-md p-3.5", completeness.isComplete ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}>
              <div className="flex items-center gap-2 text-xs font-bold">
                {completeness.isComplete ? <CheckCircle2 className="h-4 w-4" /> : <StatusDot className="border-amber-500" />}
                <span>{completeness.isComplete ? "Evidence Complete" : "Evidence Incomplete"}</span>
                <span className="ml-auto">{completeness.completed} / {completeness.required}</span>
              </div>
              <div className="my-2.5 h-1.5 overflow-hidden rounded-full bg-black/10">
                <div className="h-full rounded-full bg-current" style={{ width: `${completeness.percentage}%` }} />
              </div>
              <p className="text-[10px] leading-4 opacity-75">
                Completeness counts required inspection periods. Multiple files supporting one inspection still count as one period.
              </p>
            </div>
          </div>
        )}

        {tab === "details" && (
          <div>
            <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
              <strong className="text-3xl">{expiryNeedsReview ? "—" : record.daysRemaining}</strong>
              <div><p className="text-xs font-bold">{expiryNeedsReview ? "expiry needs review" : "days remaining"}</p><p className="text-[10px]">Expires {record.expiryDateLabel}</p></div>
            </div>
            <dl className="mt-3 text-xs">
              {[
                ["Current status", record.result === "FAILED" ? "Failed" : expiryNeedsReview ? "Review expiry" : record.daysRemaining >= 0 ? "Valid" : "Expired"],
                ["Result", record.result === "PASSED" ? "Passed" : "Failed"],
                ["Certificate", record.certificateNumber || "Not provided"],
                ["Results captured", `${record.componentResults.length}`],
                ["Review method", record.reviewMethodLabel],
                ["Record created", record.createdAtLabel],
              ].map(([label, value]) => (
                <div className="flex justify-between gap-4 border-b border-slate-100 py-3" key={label}><dt className="text-slate-500">{label}</dt><dd className="text-right font-bold text-[#183266]">{value}</dd></div>
              ))}
            </dl>
            <div className="mt-4 rounded-md bg-blue-50 p-3.5">
              <p className="flex items-center gap-2 text-xs font-bold text-[#173064]"><span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-600 text-white"><Check className="h-3 w-3" /></span> Record integrity confirmed</p>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">VIN matched, required fields resolved, certificate captured and evidence verified.</p>
            </div>
          </div>
        )}

        {tab === "activity" && (
          <div>
            {record.activity.map((event, index) => (
              <article className="relative grid min-h-24 grid-cols-[16px_1fr] gap-2.5" key={event.id}>
                {index < record.activity.length - 1 && <span className="absolute bottom-0 left-[5px] top-4 w-px bg-slate-200" />}
                <span className="z-10 mt-1 h-3 w-3 rounded-full border-2 border-[#075df5] bg-white" />
                <div><h3 className="text-xs font-bold text-[#173064]">{event.title}</h3><p className="my-1 text-[11px] leading-4 text-slate-500">{event.description}</p><small className="text-[10px] text-slate-400">{event.occurredAtLabel} · {event.actorLabel}</small></div>
              </article>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function buildReviewValues(record: AnnualInspectionRecordModel): AnnualInspectionReviewValues {
  const facility = record.linkedParties.find((party) => party.sourceRole.toLowerCase().includes("facility"))
  const technician = record.linkedParties.find((party) => party.sourceRole.toLowerCase().includes("technician"))
  const owner = record.linkedParties.find((party) => party.sourceRole.toLowerCase().includes("owner"))

  return {
    inspectionType: record.inspectionType,
    jurisdiction: record.jurisdiction,
    inspectionProgram: record.inspectionProgram,
    inspectionDate: record.inspectionDateLabel,
    expiryDate: record.expiryDateLabel,
    certificateNumber: record.certificateNumber || "",
    result: record.result,
    odometer: record.odometerLabel || "",
    vehicleIdentity: `${record.unitNumber} · ${record.vehicleIdentityVerified ? "VIN matched" : "Review required"}`,
    inspectionFacility: facility ? `${facility.label} · ${facility.subtitle}` : "",
    technicianOrContact: technician ? `${technician.label} · ${technician.subtitle}` : "",
    ownerOrOperator: owner ? owner.label : "",
  }
}

function AnnualInspectionUploadReview({
  mode,
  record,
  onClose,
  onConfirm,
}: {
  mode: ReviewMode
  record: AnnualInspectionRecordModel
  onClose: () => void
  onConfirm: (values: AnnualInspectionReviewValues) => void
}) {
  const isOcr = mode === "OCR_CREATE"
  const [values, setValues] = React.useState<AnnualInspectionReviewValues>(() => buildReviewValues(record))
  const [compared, setCompared] = React.useState(true)

  const updateText = (key: AnnualInspectionReviewTextKey, value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  const textFields: Array<[AnnualInspectionReviewTextKey, string, boolean]> = [
    ["inspectionType", "Inspection type", true],
    ["jurisdiction", "Jurisdiction", true],
    ["inspectionProgram", "Inspection program", false],
    ["inspectionDate", "Inspection date", true],
    ["expiryDate", "Expiry date", true],
    ["certificateNumber", "Certificate number", true],
    ["odometer", "Odometer", true],
    ["vehicleIdentity", "Unit / VIN match", true],
    ["inspectionFacility", "Inspection facility", false],
    ["technicianOrContact", "Technician / contact", false],
    ["ownerOrOperator", "Owner / operator", false],
  ]

  return (
    <div className="fixed inset-0 z-[100] bg-[#071222]/60 p-2 sm:p-4" role="presentation">
      <section className="grid h-full overflow-hidden rounded-lg bg-[#f3f6fb] shadow-2xl lg:grid-rows-[66px_1fr]" role="dialog" aria-modal="true" aria-labelledby="annual-inspection-review-title">
        <header className="flex min-h-[66px] items-center justify-between border-b border-slate-200 bg-white px-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{isOcr ? "Upload / OCR review" : "Evidence verification"}</p>
            <h2 className="text-base font-bold text-[#071846]" id="annual-inspection-review-title">
              {isOcr ? "Review OCR fields before creating the record" : "Verify evidence against Annual Inspection record"}
            </h2>
          </div>
          <button className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-600" onClick={onClose} type="button" aria-label="Close review"><X className="h-4 w-4" /></button>
        </header>

        <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_430px]">
          <section className="hidden min-h-0 grid-rows-[46px_1fr] border-r border-slate-200 bg-slate-100 lg:grid" aria-label="Evidence preview">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 text-xs text-[#19376c]"><strong className="truncate">Commercial Vehicle Inspection Certificate.pdf</strong><span className="whitespace-nowrap text-slate-500">Page 1 of 1 · Audited view · 100%</span></div>
            <div className="overflow-auto p-6">
              <article className="relative mx-auto min-h-[760px] w-full max-w-[650px] bg-white p-10 shadow-xl">
                <div className="text-center text-lg font-extrabold text-slate-800">ALBERTA GOVERNMENT</div>
                <div className="mb-6 mt-1 text-center text-sm font-extrabold text-slate-800">COMMERCIAL VEHICLE INSPECTION CERTIFICATE</div>
                <div className="grid grid-cols-2 border-l border-t border-slate-400 text-xs">
                  {[
                    ["Certificate number", values.certificateNumber], ["Inspection result", values.result === "PASSED" ? "Passed" : "Failed"],
                    ["Vehicle", record.vehicleLabel], ["Unit number", record.unitNumber],
                    ["Inspection date", values.inspectionDate], ["Expiry date", values.expiryDate],
                    ["Inspection facility", values.inspectionFacility], ["Technician", values.technicianOrContact],
                    ["Owner / operator", values.ownerOrOperator], ["Jurisdiction", values.jurisdiction],
                  ].map(([label, value]) => <div className="border-b border-r border-slate-400 p-3" key={label}><b className="mb-1 block text-[10px] uppercase text-slate-500">{label}</b>{value || "Not captured"}</div>)}
                </div>
                <div className="pointer-events-none absolute left-[12%] top-1/2 -rotate-[28deg] whitespace-nowrap text-xl font-extrabold tracking-widest text-[#091b4d]/10">TES AUDITED VIEW · OWNER</div>
              </article>
            </div>
          </section>

          <aside className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] bg-white">
            <div className="border-b border-slate-200 px-4 py-4">
              <span className="mb-2 inline-flex rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#075df5]">{isOcr ? "OCR record creation" : "Evidence-only upload"}</span>
              <h3 className="text-base font-bold text-[#071846]">{isOcr ? "Review extracted Annual Inspection data" : "Final record verification"}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{isOcr ? "These are the same fields used by manual Annual Inspection entry. Correct any OCR mismatch here." : "Compare the source with the existing manual record. The file is not attached until you verify it."}</p>
            </div>
            <div className="mx-4 mt-3 rounded-md bg-amber-50 p-3 text-[11px] leading-4 text-amber-800">{isOcr ? <>Saving creates <strong>one Annual Inspection record</strong> and attaches this file as its evidence.</> : <>This file attaches to <strong>{record.id}</strong>. It does not create another record.</>}</div>
            <div className="grid content-start gap-3 overflow-y-auto p-4">
              {textFields.map(([key, label, compact]) => (
                <label className={cn("grid gap-1", compact && "sm:inline-grid sm:w-[calc(50%-0.375rem)] sm:align-top sm:[&:nth-of-type(even)]:ml-2")} key={key}>
                  <span className="flex justify-between text-[11px] font-bold text-[#263d6c]">{label}<em className="not-italic text-[10px] text-emerald-600">Matched</em></span>
                  <input className="h-10 rounded-md border border-slate-300 px-3 text-xs text-[#102653] outline-none focus:border-[#075df5] focus:ring-2 focus:ring-blue-100" value={values[key]} onChange={(event) => updateText(key, event.target.value)} />
                </label>
              ))}
              <label className="grid gap-1"><span className="flex justify-between text-[11px] font-bold text-[#263d6c]">Result<em className="not-italic text-[10px] text-emerald-600">Matched</em></span><select className="h-10 rounded-md border border-slate-300 px-3 text-xs text-[#102653]" value={values.result} onChange={(event) => setValues((current) => ({ ...current, result: event.target.value as AnnualInspectionReviewValues["result"] }))}><option value="PASSED">Passed</option><option value="FAILED">Failed</option></select></label>
              <label className="grid grid-cols-[18px_1fr] gap-2 rounded-md border border-emerald-100 bg-emerald-50 p-3"><input className="mt-0.5 accent-emerald-600" checked={compared} onChange={(event) => setCompared(event.target.checked)} type="checkbox" /><span><strong className="block text-[11px] text-[#173064]">I compared the record with the source evidence</strong><small className="text-[10px] leading-4 text-slate-500">Confirm identity, dates, certificate, parties and result before saving.</small></span></label>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 p-3"><button className="px-3 py-2 text-xs font-bold text-slate-500" onClick={onClose} type="button">Discard</button><button className="rounded-md bg-[#075df5] px-4 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!compared} onClick={() => onConfirm(values)} type="button">{isOcr ? "Confirm & create record" : "Verify & attach evidence"}</button></div>
          </aside>
        </div>
      </section>
    </div>
  )
}

export function AnnualInspectionRecord({
  record,
  onEdit,
  onArchive,
  onUploadEvidence,
  onVerifyAndAttachEvidence,
  onBackToList,
  onOpenEvidence,
  onOpenLinkedParty,
  onOpenBiNode,
}: AnnualInspectionRecordProps) {
  const [pageTab, setPageTab] = React.useState<"overview" | "results">("overview")
  const [reviewMode, setReviewMode] = React.useState<ReviewMode | null>(null)
  const validityLabel = record.result === "FAILED"
    ? "Failed"
    : record.daysRemaining < 0
      ? "Expired"
      : record.daysRemaining > 366
        ? "Review expiry"
        : "Valid"

  const openEvidenceReview = () => {
    onUploadEvidence?.()
    setReviewMode("EVIDENCE_ATTACH")
  }

  const confirmReview = (values: AnnualInspectionReviewValues) => {
    if (reviewMode === "EVIDENCE_ATTACH") onVerifyAndAttachEvidence?.(values)
    setReviewMode(null)
  }

  return (
    <div className="min-h-screen bg-[#f7faff] text-[#0b1b4a] xl:pr-[340px]">
      <main className="mx-auto w-full max-w-[1500px] p-4 lg:p-5">
        <p className="mb-3 text-xs text-[#5870a0]">
          Vehicles / {record.unitNumber} / Maintenance / {onBackToList ? <button className="font-semibold text-[#075df5] hover:underline" onClick={onBackToList} type="button">Annual / Periodic Inspections</button> : "Annual / Periodic Inspections"} / Record
        </p>
        <header className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[#071846]">Annual Inspection</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-[#59709c]">
              <strong>{record.unitNumber}</strong><span>·</span><span>{record.vehicleLabel}</span><span>·</span>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold", validityLabel === "Valid" ? "bg-emerald-50 text-emerald-700" : validityLabel === "Review expiry" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700")}><StatusDot className={cn("h-2 w-2", validityLabel === "Valid" ? "border-emerald-500" : validityLabel === "Review expiry" ? "border-amber-500" : "border-red-500")} /> {validityLabel}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700" onClick={onArchive} type="button"><Archive className="h-4 w-4" /> Archive</button>
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#075df5] px-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/15" onClick={onEdit} type="button"><Pencil className="h-4 w-4" /> Edit record</button>
          </div>
        </header>

        <div className="mb-4 flex border-b border-slate-200">
          {(["overview", "results"] as const).map((value) => (
            <button className={cn("relative px-4 py-3 text-sm font-semibold text-slate-500", pageTab === value && "text-[#075df5] after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:bg-[#075df5]")} key={value} onClick={() => setPageTab(value)} type="button">
              {value === "overview" ? "Overview" : `Inspection Results (${record.componentResults.length})`}
            </button>
          ))}
        </div>

        {pageTab === "overview" ? (
          <RecordOverview record={record} onEdit={onEdit} onOpenLinkedParty={onOpenLinkedParty} />
        ) : (
          <InspectionResults record={record} onOpenBiNode={onOpenBiNode} />
        )}
      </main>

      <RecordInspector record={record} onOpenEvidence={onOpenEvidence} onUploadEvidence={openEvidenceReview} />
      {reviewMode && <AnnualInspectionUploadReview mode={reviewMode} record={record} onClose={() => setReviewMode(null)} onConfirm={confirmReview} />}
    </div>
  )
}

/*
Integration rule for the current record:

requiredPeriods: [
  {
    id: "current-annual-inspection",
    label: "Current annual-inspection period",
    annualInspectionRecordId: "AI-1946-2025-01",
    evidenceDocumentIds: ["certificate-document-id", "detailed-report-document-id"],
    status: "VERIFIED",
  },
]

The two document IDs above produce Documents (2), but completeness remains 1 / 1.

If TES requires two historical periods, pass two AnnualInspectionPeriodRequirement
objects. A missing year uses status: "MISSING" and produces 1 / 2 or 0 / 2.
*/
