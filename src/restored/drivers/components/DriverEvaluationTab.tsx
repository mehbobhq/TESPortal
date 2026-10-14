"use client"

import * as React from "react"
import type { DriverApplicationRecord } from "@/types/drivers"
import { EmploymentEvaluationPanel } from "./EmploymentEvaluationPanel"

type Props = {
  companyId: string
  applications: DriverApplicationRecord[]
}

const terminalApplicationStatuses = new Set(["Submitted", "Under Review", "Approved", "Rejected", "Superseded"])

export function DriverEvaluationTab({ companyId, applications }: Props) {
  const reviewable = React.useMemo(
    () => [...applications]
      .filter((application) => terminalApplicationStatuses.has(application.status))
      .sort((a, b) => String(b.submittedDate ?? b.updatedAt ?? "").localeCompare(String(a.submittedDate ?? a.updatedAt ?? ""))),
    [applications],
  )
  const [applicationId, setApplicationId] = React.useState(reviewable[0]?.id ?? "")

  React.useEffect(() => {
    if (!reviewable.some((item) => item.id === applicationId)) setApplicationId(reviewable[0]?.id ?? "")
  }, [reviewable, applicationId])

  const active = reviewable.find((item) => item.id === applicationId)

  if (!active) {
    return <div className="rounded-xl border border-dashed p-8 text-center">
      <div className="text-sm font-semibold">No submitted application is available for evaluation.</div>
      <p className="mt-2 text-xs text-muted-foreground">A hiring evaluation starts from an immutable submitted application. Draft or invited applications are not treated as completed applicant statements.</p>
    </div>
  }

  return <div className="space-y-4">
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Hiring Evaluation</div>
          <h2 className="mt-1 text-lg font-bold">Application review & verification</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
            TES evaluates the submitted application against evidence, required inquiries and applicable qualification requirements. The submitted applicant answers remain unchanged. Carrier employment determination remains separate from TES verification and qualification assessment.
          </p>
        </div>
        {reviewable.length > 1 && <select className="rounded-lg border bg-background px-3 py-2 text-xs" value={applicationId} onChange={(e)=>setApplicationId(e.target.value)}>
          {reviewable.map((item)=><option key={item.id} value={item.id}>{item.id} · {item.status}</option>)}
        </select>}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Summary label="Application" value={active.id} />
        <Summary label="Application status" value={active.status} />
        <Summary label="File completeness" value={active.processing?.fileCompleteness ?? "Not Assessed"} />
        <Summary label="Qualification assessment" value={active.processing?.qualificationAssessment ?? "Not Assessed"} />
        <Summary label="Open findings" value={String((active.findings ?? []).filter((finding) => finding.status !== "Resolved").length)} />
      </div>
    </div>

    <div className="grid gap-3 md:grid-cols-4">
      {["Application Review","Evidence Reconciliation","Required Inquiries","Qualification Assessment"].map((label, index)=>
        <div key={label} className="rounded-xl border bg-card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Stage {index + 1}</div>
          <div className="mt-1 text-sm font-semibold">{label}</div>
          <div className="mt-2 text-xs text-muted-foreground">{index === 0 ? "Submitted claims and completeness." : index === 1 ? "Claims compared with connected evidence." : index === 2 ? "Employer and applicable external checks." : "Requirement-by-requirement assessment with rationale."}</div>
        </div>)}
    </div>

    <div className="rounded-xl border bg-card overflow-hidden">
      <EmploymentEvaluationPanel companyId={companyId} applicationId={active.id} />
    </div>

    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-900">
      <strong>Evaluation rule:</strong> missing, conflicting or unavailable information creates a review/verification state; it does not by itself establish dishonesty, poor character or disqualification. Any qualification impact must be tied to an applicable requirement and supporting evidence.
    </div>
  </div>
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-muted/10 p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 break-words text-xs font-semibold">{value}</div></div>
}
