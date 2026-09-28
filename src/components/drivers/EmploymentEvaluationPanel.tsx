"use client"

import * as React from "react"
import { Plus, Trash2 } from "lucide-react"
import {
  createEmploymentEvaluation,
  deriveEmploymentEvaluationStatus,
  loadEmploymentEvaluations,
  saveEmploymentEvaluations,
  type EmploymentEvaluationRecord,
} from "@/lib/driver-employment-evaluation"

export function EmploymentEvaluationPanel({ companyId, applicationId }: { companyId: string; applicationId: string }) {
  const [records, setRecords] = React.useState<EmploymentEvaluationRecord[]>([])
  React.useEffect(() => setRecords(loadEmploymentEvaluations(companyId, applicationId)), [companyId, applicationId])

  const commit = (next: EmploymentEvaluationRecord[]) => {
    const stamped = next.map((r) => ({ ...r, status: deriveEmploymentEvaluationStatus(r), updatedAt: new Date().toISOString() }))
    setRecords(stamped); saveEmploymentEvaluations(companyId, applicationId, stamped)
  }
  const add = () => commit([...records, createEmploymentEvaluation(companyId, applicationId)])
  const patch = (id: string, p: Partial<EmploymentEvaluationRecord>) => commit(records.map((r) => r.id === id ? { ...r, ...p } : r))
  const addAttempt = (id: string) => patch(id, { attempts: [...(records.find(r=>r.id===id)?.attempts ?? []), { id:`ATT-${Date.now()}`, attemptedAt:new Date().toISOString().slice(0,16), method:"Email", outcome:"" }] })

  const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
  return <div className="border-t border-border">
    <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/10 px-4 py-3">
      <div><div className="text-xs font-bold uppercase tracking-wider">Previous Employer Evaluation</div><p className="mt-1 text-[11px] text-muted-foreground">Internal TES/carrier verification record. Employer responses, contact attempts and applicant rebuttals remain separate from the submitted application.</p></div>
      <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold"><Plus className="size-3.5"/> Add employer evaluation</button>
    </div>
    {records.length===0 ? <div className="p-5 text-center text-xs text-muted-foreground">No previous-employer evaluations recorded.</div> :
    <div className="divide-y divide-border">{records.map((r)=><div key={r.id} className="space-y-4 p-4">
      <div className="flex justify-between gap-3"><div><div className="text-sm font-bold">{r.employerName || "Employer evaluation"}</div><div className="text-[10px] text-muted-foreground">Status: {r.status}</div></div><button type="button" onClick={()=>commit(records.filter(x=>x.id!==r.id))} className="text-destructive"><Trash2 className="size-4"/></button></div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-[11px] font-semibold">Employer name<input className={input} value={r.employerName} onChange={e=>patch(r.id,{employerName:e.target.value})}/></label>
        <label className="text-[11px] font-semibold">Employer contact<input className={input} value={r.employerContact} onChange={e=>patch(r.id,{employerContact:e.target.value})}/></label>
        <label className="text-[11px] font-semibold">Verified start date<input className={input} placeholder="YYYY-MM-DD" value={r.employmentStartDate} onChange={e=>patch(r.id,{employmentStartDate:e.target.value})}/></label>
        <label className="text-[11px] font-semibold">Verified end date<input className={input} placeholder="YYYY-MM-DD" value={r.employmentEndDate} onChange={e=>patch(r.id,{employmentEndDate:e.target.value})}/></label>
        <label className="text-[11px] font-semibold">Position/title<input className={input} value={r.positionTitle} onChange={e=>patch(r.id,{positionTitle:e.target.value})}/></label>
        <label className="text-[11px] font-semibold">Regulated CMV work?<select className={input} value={r.regulatedCommercialDriving} onChange={e=>patch(r.id,{regulatedCommercialDriving:e.target.value as any})}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option></select></label>
        <label className="text-[11px] font-semibold">Performance response<select className={input} value={r.performanceResponse} onChange={e=>patch(r.id,{performanceResponse:e.target.value as any})}><option value="">Select</option><option>Good</option><option>Average</option><option>Poor</option><option>Not Provided</option></select></label>
        <label className="text-[11px] font-semibold">Reason employment ended<select className={input} value={r.separationResponse} onChange={e=>patch(r.id,{separationResponse:e.target.value as any})}><option value="">Select</option><option>Dismissed</option><option>Resigned</option><option>Laid Off</option><option>Other</option><option>Not Provided</option></select></label>
        <label className="text-[11px] font-semibold">Drug/alcohol testing required?<select className={input} value={r.drugAlcoholTestingRequired} onChange={e=>patch(r.id,{drugAlcoholTestingRequired:e.target.value as any})}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option></select></label>
        <label className="text-[11px] font-semibold">Would rehire / work again?<select className={input} value={r.rehireResponse} onChange={e=>patch(r.id,{rehireResponse:e.target.value as any})}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option><option value="upon-review">Upon review</option><option value="not-provided">Not provided</option></select></label>
        <label className="text-[11px] font-semibold">Information provided by<input className={input} value={r.informationProvidedBy} onChange={e=>patch(r.id,{informationProvidedBy:e.target.value})}/></label>
        <label className="text-[11px] font-semibold">Provider position/title<input className={input} value={r.providerPosition} onChange={e=>patch(r.id,{providerPosition:e.target.value})}/></label>
        <label className="text-[11px] font-semibold">Response date<input className={input} placeholder="YYYY-MM-DD" value={r.responseDate} onChange={e=>patch(r.id,{responseDate:e.target.value})}/></label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-[11px] font-semibold">Performance / separation details<textarea className={input} value={r.performanceDetails} onChange={e=>patch(r.id,{performanceDetails:e.target.value})}/></label>
        <label className="text-[11px] font-semibold">Incidents / citations / other factual notes<textarea className={input} value={r.incidentDetails} onChange={e=>patch(r.id,{incidentDetails:e.target.value})}/></label>
      </div>
      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between"><div className="text-xs font-bold">Contact attempts</div><button type="button" onClick={()=>addAttempt(r.id)} className="text-xs font-semibold">+ Add attempt</button></div>
        <div className="mt-2 space-y-2">{r.attempts.map(a=><div key={a.id} className="grid gap-2 md:grid-cols-3"><input className={input} value={a.attemptedAt} onChange={e=>patch(r.id,{attempts:r.attempts.map(x=>x.id===a.id?{...x,attemptedAt:e.target.value}:x)})}/><select className={input} value={a.method} onChange={e=>patch(r.id,{attempts:r.attempts.map(x=>x.id===a.id?{...x,method:e.target.value as any}:x)})}><option>Email</option><option>Phone</option><option>Portal</option><option>Mail</option><option>Other</option></select><input className={input} placeholder="Outcome" value={a.outcome} onChange={e=>patch(r.id,{attempts:r.attempts.map(x=>x.id===a.id?{...x,outcome:e.target.value}:x)})}/></div>)}</div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={r.noHistoryCertification} onChange={e=>patch(r.id,{noHistoryCertification:e.target.checked})}/>No employment history / unable-to-verify certification applies after documented attempts.</label>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={r.drugAlcoholRecordsRequestNeeded} onChange={e=>patch(r.id,{drugAlcoholRecordsRequestNeeded:e.target.checked})}/>Drug/alcohol records request workflow required.</label>
      </div>
      <div className="rounded-lg border p-3">
        <div className="text-xs font-bold">TES verification assessment</div>
        <p className="mt-1 text-[11px] text-muted-foreground">Record the verification result and any job-qualification impact supported by the evidence. Do not infer honesty, character or intent from a discrepancy.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-[11px] font-semibold">Verification outcome<select className={input} value={r.verificationOutcome ?? ""} onChange={e=>patch(r.id,{verificationOutcome:e.target.value as any})}><option value="">Select</option><option>Verified</option><option>Partially Verified</option><option>Unable to Verify</option><option>Discrepancy / Clarification Required</option></select></label>
          <label className="text-[11px] font-semibold">Qualification impact<select className={input} value={r.qualificationImpact ?? "Not Assessed"} onChange={e=>patch(r.id,{qualificationImpact:e.target.value as any})}><option>Not Assessed</option><option>No Issue Identified</option><option>Review Required</option><option>Requirement Not Met</option></select></label>
        </div>
        <textarea className={`${input} mt-3`} placeholder="Evidence-based assessment rationale" value={r.assessmentRationale ?? ""} onChange={e=>patch(r.id,{assessmentRationale:e.target.value})}/>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <label className="flex items-start gap-2 text-xs font-semibold"><input type="checkbox" checked={r.applicantDisputesInformation} onChange={e=>patch(r.id,{applicantDisputesInformation:e.target.checked})}/>Applicant disputes information supplied by the employer.</label>
        {r.applicantDisputesInformation && <div className="mt-3 grid gap-3 md:grid-cols-2"><textarea className={input} placeholder="Applicant statement / rebuttal" value={r.applicantStatement} onChange={e=>patch(r.id,{applicantStatement:e.target.value})}/><select className={input} value={r.employerRevisionResponse} onChange={e=>patch(r.id,{employerRevisionResponse:e.target.value as any})}><option value="">Employer response pending</option><option>Information Accurate</option><option>Revised</option><option>No Response</option></select></div>}
      </div>
    </div>)}</div>}
  </div>
}
