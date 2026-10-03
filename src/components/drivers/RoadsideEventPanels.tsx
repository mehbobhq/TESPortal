"use client"

import * as React from "react"
import Link from "next/link"

import type { DriverPerformanceEvent } from "@/types/drivers"
import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE } from "@/lib/driver-performance-schema"
import { getRoadsideEquipmentCollection } from "@/lib/driver-performance-child-facts"
import { eventFactsByKey, getRoadsideOpenActions, roadsideDriverStatementState } from "@/lib/driver-performance-families"
import {
  correctPerformanceEventFacts,
  getLinkableCitationsForRoadside,
  getRoadsideLinkedCitations,
  linkRoadsideInspectionCitation,
  recordRoadsideDriverStatement,
  updatePerformanceEventWorkflow,
} from "@/lib/driver-data"
import { getJurisdictionLabel } from "@/lib/jurisdictions"

const fieldsOf = () => DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Roadside Inspection"]?.fields || []

/** Compact one-line Roadside identity: title first, then the facts that identify the inspection. Wraps on narrow screens. */
export function RoadsideSummaryLine({ event, title, driverName }: { event: DriverPerformanceEvent; title: string; driverName: string }) {
  const fields = fieldsOf()
  const facts = eventFactsByKey(event, fields)
  const optionLabel = (key: string) => {
    const value = facts[key]
    if (typeof value !== "string") return undefined
    return fields.find((field) => field.key === key)?.options?.find((option) => option.value === value)?.label || value
  }
  const date = (() => {
    const parsed = new Date(`${event.eventDate}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? event.eventDate : parsed.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })
  })()
  const level = optionLabel("inspectionClassification")?.split(" — ")[0]
  const jurisdiction = typeof facts.jurisdiction === "string" && facts.jurisdiction ? getJurisdictionLabel(facts.jurisdiction) : undefined
  const report = typeof facts.inspectionReportNumber === "string" && facts.inspectionReportNumber ? `Report #${facts.inspectionReportNumber}` : undefined
  const powerUnit = getRoadsideEquipmentCollection(event)?.items.find((item) => item.facts.role === "POWER_UNIT")
  const unit = powerUnit ? String(powerUnit.facts.sourceUnitNumber || powerUnit.facts.sourcePlate || "") : ""
  const parts = [date, level, jurisdiction, report, driverName ? `Driver: ${driverName}` : undefined, unit ? `Unit ${unit}` : undefined].filter(Boolean) as string[]
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-sm font-bold text-foreground">{title}</span>
      {parts.map((part) => <span key={part} className="text-xs text-muted-foreground"><span aria-hidden="true">· </span>{part}</span>)}
    </div>
  )
}

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"

/**
 * Roadside workflow panels: required actions (Driver Statement, follow-up) and linked Tickets / Citations.
 * Overall Outcome is never edited here, and a Citation's lifecycle never gates Roadside closure.
 */
export function RoadsideEventPanels({ event, companyId, onChange }: { event: DriverPerformanceEvent; companyId: string; onChange: () => void }) {
  const [tick, setTick] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [statement, setStatement] = React.useState({ status: "OBTAINED" as "OBTAINED" | "REQUESTED" | "DECLINED" | "UNABLE_TO_OBTAIN", date: "", time: "", method: "" as "" | "WRITTEN" | "RECORDED" | "INTERVIEW" | "UPLOADED_DOCUMENT" | "OTHER", content: "" })
  const [requirement, setRequirement] = React.useState<"" | "YES" | "NO">("")
  const [requirementReason, setRequirementReason] = React.useState("")
  const [citationToLink, setCitationToLink] = React.useState("")

  const fields = fieldsOf()
  const facts = eventFactsByKey(event, fields)
  const openActions = getRoadsideOpenActions(event, facts)
  const statementState = roadsideDriverStatementState(event, facts)
  const linked = React.useMemo(() => getRoadsideLinkedCitations(companyId, event), [companyId, event, tick])
  const linkable = React.useMemo(() => getLinkableCitationsForRoadside(companyId, event), [companyId, event, tick])
  const statementCount = event.childCollections?.find((collection) => collection.collectionId === "DRV.PERF.ROADSIDE_INSPECTION.DRIVER_STATEMENTS")?.items.length || 0

  const run = (action: () => void) => {
    setError(null)
    try { action(); setTick((value) => value + 1); onChange() } catch (cause) { setError(cause instanceof Error ? cause.message : "The action could not be completed.") }
  }

  const requiredField = fields.find((field) => field.key === "driverStatementRequired")
  const currentRequirement = typeof facts.driverStatementRequired === "string" ? facts.driverStatementRequired : ""

  return (
    <div className="space-y-4">
      {error ? <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div> : null}

      <div className="rounded-xl border border-border bg-background p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Required Actions</h4>
          <span className="text-[11px] text-muted-foreground">Workflow Status: <strong className="text-foreground">{event.status === "Open" || event.status === "Closed" ? event.status : "Not tracked (legacy record)"}</strong> · Overall Outcome is unaffected by workflow status</span>
        </div>
        {openActions.length === 0
          ? <p className="text-xs text-muted-foreground">No required actions are outstanding.</p>
          : <ul className="space-y-1">{openActions.map((action) => <li key={action.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200"><span className="font-semibold">{action.label}</span>
            {action.key === "FOLLOW_UP" ? <button type="button" onClick={() => run(() => { updatePerformanceEventWorkflow(companyId, event.id, { followUpActionRequired: false }) })} className="ml-auto rounded-md border border-border bg-background px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-muted">Mark follow-up complete</button> : null}</li>)}</ul>}
        {openActions.length ? <p className="text-[10px] text-muted-foreground">This inspection stays Open until every required action above is resolved. Linked Citations do not affect closure.</p> : null}

        <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <label className="text-[11px] font-semibold">Driver Statement {currentRequirement === "YES" ? "- Required" : currentRequirement === "NO" ? "- Not required" : "- requirement not determined"} · {statementState.provided ? "Provided" : "Not provided"}
            <select value={requirement} onChange={(e) => setRequirement(e.target.value as "" | "YES" | "NO")} className={`${inputClass} mt-1 block`} aria-label="Update Driver Statement requirement">
              <option value="">Update requirement...</option>
              <option value="YES">Required</option>
              <option value="NO">Not required</option>
            </select>
          </label>
          <input value={requirementReason} onChange={(e) => setRequirementReason(e.target.value)} placeholder="Reason for this determination (findings, circumstances, policy)" className={inputClass} aria-label="Reason for Driver Statement determination" />
          <button type="button" disabled={!requirement || !requirementReason.trim() || !requiredField} onClick={() => run(() => {
            if (!requiredField || !requirement) return
            correctPerformanceEventFacts(companyId, event.id, [{ dataPointId: requiredField.dataPointId, previousValue: (typeof facts.driverStatementRequired === "string" ? facts.driverStatementRequired : undefined), newValue: requirement, reason: requirementReason.trim(), actor: null }])
            setRequirement(""); setRequirementReason("")
          })} className="rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] font-bold text-foreground hover:bg-muted disabled:opacity-50">Save</button>
        </div>

        <details className="border-t border-border pt-3" open={statementState.required && !statementState.provided}>
          <summary className="cursor-pointer text-xs font-bold text-foreground">Record a Driver Statement{statementCount ? ` (${statementCount} on record)` : ""} <span className="font-normal text-muted-foreground">- available on every inspection, required or not</span></summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select aria-label="Statement status" value={statement.status} onChange={(e) => setStatement((value) => ({ ...value, status: e.target.value as typeof value.status }))} className={inputClass}><option value="OBTAINED">Obtained</option><option value="REQUESTED">Requested</option><option value="DECLINED">Declined</option><option value="UNABLE_TO_OBTAIN">Unable to Obtain</option></select>
            <input aria-label="Statement date" type="date" value={statement.date} onChange={(e) => setStatement((value) => ({ ...value, date: e.target.value }))} className={inputClass} />
            <input aria-label="Statement time" type="time" value={statement.time} onChange={(e) => setStatement((value) => ({ ...value, time: e.target.value }))} className={inputClass} />
            <select aria-label="Statement method" value={statement.method} onChange={(e) => setStatement((value) => ({ ...value, method: e.target.value as typeof value.method }))} className={inputClass}><option value="">Method</option><option value="WRITTEN">Written</option><option value="RECORDED">Recorded</option><option value="INTERVIEW">Interview</option><option value="OTHER">Other</option></select>
            <textarea aria-label="Statement content" rows={3} value={statement.content} onChange={(e) => setStatement((value) => ({ ...value, content: e.target.value }))} placeholder="Driver's actual account / statement" className={`${inputClass} sm:col-span-2 lg:col-span-4`} />
          </div>
          <div className="mt-2 flex justify-end"><button type="button" onClick={() => run(() => {
            recordRoadsideDriverStatement(companyId, event.id, { status: statement.status, date: statement.date || undefined, time: statement.time || undefined, method: statement.method || undefined, content: statement.content.trim() || undefined }, null)
            setStatement({ status: "OBTAINED", date: "", time: "", method: "", content: "" })
          })} className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground hover:opacity-90">Save Statement</button></div>
        </details>
      </div>

      <div className="rounded-xl border border-border bg-background p-4 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Tickets / Citations ({linked.length})</h4>
        {linked.length === 0 ? <p className="text-xs text-muted-foreground">No Citation is linked to this inspection. A Citation is its own record with its own lifecycle and is not required for this inspection.</p> : (
          <ul className="space-y-1">{linked.map((citation) => (
            <li key={citation.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/10 px-3 py-1.5 text-xs">
              {citation.missing ? <span className="font-mono font-semibold text-muted-foreground">{citation.label}</span> : <Link href={`/companies/${companyId}/citations?citation=${encodeURIComponent(citation.id)}`} className="font-mono font-semibold text-primary hover:underline">Citation #{citation.label}</Link>}
              <span className="text-muted-foreground">{citation.missing ? "Linked record not found in Tickets / Citations" : (citation.citationType || "").replaceAll("_", " ")}</span>
              {citation.missing ? null : <span className={`ml-auto rounded px-2 py-0.5 text-[10px] font-bold ${citation.closed ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"}`} title={citation.adjudicationStatus}>{citation.closed ? "Closed" : "Open"}</span>}
            </li>
          ))}</ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Link a Citation" value={citationToLink} onChange={(e) => setCitationToLink(e.target.value)} className={`${inputClass} min-w-[14rem]`}>
            <option value="">{linkable.length ? "Link an existing Citation..." : "No unlinked Citations available"}</option>
            {linkable.map((citation) => <option key={citation.id} value={citation.id}>#{citation.label} · {(citation.citationType || "").replaceAll("_", " ")} · {citation.closed ? "Closed" : "Open"}</option>)}
          </select>
          <button type="button" disabled={!citationToLink} onClick={() => run(() => { linkRoadsideInspectionCitation(companyId, event.id, citationToLink, null); setCitationToLink("") })} className="rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] font-bold text-foreground hover:bg-muted disabled:opacity-50">Link Citation</button>
          <Link href={`/companies/${companyId}/citations`} className="text-[11px] font-semibold text-primary hover:underline">Open Tickets / Citations</Link>
        </div>
      </div>
    </div>
  )
}
