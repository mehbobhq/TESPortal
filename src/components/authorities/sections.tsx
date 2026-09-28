import React from "react"
import { FileCheck2, History, Landmark, Plus, ShieldCheck } from "lucide-react"
import { getDeadlineStatus, getDeadlineClasses } from "@/lib/deadline-engine"
import type { AuthorityRecord, SafetyRecord, AuditRecord, DeadlineRules, SelectedRecord } from "@/lib/authorities/types"
import { DeadlineBadge, ScanDocumentIcon } from "./shared-fields"

function AuthorityRow({
  record,
  rules,
  selected,
  onClick,
}: {
  record: AuthorityRecord
  rules: DeadlineRules
  selected: boolean
  onClick: () => void
}) {
  const deadline =
    record.authorityType === "MCS150"
      ? record.nextActionDate
      : record.expiryDate

  const deadlineStatus = getDeadlineStatus(deadline, rules)
  const style = getDeadlineClasses(deadlineStatus)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full gap-4 border-l-4 p-4 text-left transition-colors md:grid-cols-12 ${
        style.left
      } ${selected ? "bg-primary/[0.045]" : "hover:bg-muted/25"} ${
        record.isArchived ? "opacity-60 bg-muted/10" : ""
      }`}
    >
      <div className="md:col-span-3">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground">{record.name}</p>
          {record.isArchived && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-muted text-muted-foreground border border-border">
              Archived
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {record.id}
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="select-text font-mono text-xs font-medium text-foreground">
          {record.number || "—"}
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {record.issuingAuthority || "Issuing authority not recorded"}
        </p>
      </div>

      <div className="md:col-span-2">
        <p className="text-xs font-medium text-foreground">{record.jurisdictionLabel}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{record.country}</p>
      </div>

      <div className="md:col-span-2">
        <p className="text-[10px] text-muted-foreground">
          {record.authorityType === "MCS150" ? "Next Action" : "Expiry"}
        </p>
        <p className="mt-1 text-xs font-medium text-foreground">{deadline || "Continuous"}</p>
      </div>

      <div className="flex items-center justify-end md:col-span-2">
        <DeadlineBadge status={deadlineStatus} />
      </div>
    </button>
  )
}

function SafetyRow({
  record,
  selected,
  onClick,
}: {
  record: SafetyRecord
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
        selected ? "bg-primary/[0.045]" : "hover:bg-muted/25"
      } ${record.isArchived ? "opacity-60 bg-muted/10" : ""}`}
    >
      <div className="md:col-span-4">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground">
            {record.system === "CARRIER_PROFILE_CVOR"
              ? "Carrier Profile / CVOR"
              : "SMS Profile"}
          </p>
          {record.isArchived && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-muted text-muted-foreground border border-border">
              Archived
            </span>
          )}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {record.jurisdictionLabel}
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="text-[10px] text-muted-foreground">Review Date</p>
        <p className="mt-1 text-xs font-medium text-foreground">{record.reviewDate}</p>
      </div>

      <div className="md:col-span-5">
        <p className="text-xs text-foreground">{record.summary || "No summary recorded."}</p>
      </div>
    </button>
  )
}

export function AuditRow({
  record,
  selected,
  onClick,
}: {
  record: AuditRecord
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
        selected ? "bg-primary/[0.045]" : "hover:bg-muted/25"
      } ${record.isArchived ? "opacity-60 bg-muted/10" : ""}`}
    >
      <div className="md:col-span-3">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground">{record.auditType}</p>
          {record.isArchived && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-muted text-muted-foreground border border-border">
              Archived
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {record.referenceNumber || record.id}
        </p>
      </div>

      <div className="md:col-span-3">
        <p className="text-xs font-medium text-foreground">{record.regulator}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {record.jurisdictionLabel}
        </p>
      </div>

      <div className="md:col-span-2">
        <p className="text-[10px] text-muted-foreground">Due</p>
        <p className="mt-1 text-xs text-foreground">{record.dueDate || "—"}</p>
      </div>

      <div className="md:col-span-2">
        <p className="text-[10px] text-muted-foreground">Completed</p>
        <p className="mt-1 text-xs text-foreground">{record.completedDate || "—"}</p>
      </div>

      <div className="flex justify-end md:col-span-2">
        <span className="px-2 py-0.5 rounded text-xs font-medium border border-border bg-background text-foreground">
          {record.status}
        </span>
      </div>
    </button>
  )
}

/* =========================================================
   SECTIONS
========================================================= */

export function AuthoritySection({
  title,
  description,
  records,
  rules,
  selectedId,
  onSelect,
  onScan,
  onManual,
}: {
  title: string
  description: string
  records: AuthorityRecord[]
  rules: DeadlineRules
  selectedId?: string
  onSelect: (record: AuthorityRecord) => void
  onScan: () => void
  onManual: () => void
}) {
  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
      <div className="border-b border-border bg-muted/20 px-5 py-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onScan}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <ScanDocumentIcon size={14} />
              <span className="ml-1.5">Scan Document</span>
            </button>
            <button
              type="button"
              onClick={onManual}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
            >
              <Plus className="mr-1.5 size-3.5" />
              Add Record
            </button>
          </div>
        </div>
      </div>

      <div>
        {records.length === 0 ? (
          <div className="p-10 text-center">
            <Landmark className="mx-auto size-9 text-muted-foreground/30" />
            <p className="mt-3 text-sm font-medium text-foreground">No records found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {records.map((record) => (
              <div key={record.id}>
                <AuthorityRow
                  record={record}
                  rules={rules}
                  selected={selectedId === record.id}
                  onClick={() => onSelect(record)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function SafetySection({
  title,
  records,
  selected,
  onSelect,
  onScan,
  onManual,
}: {
  title: string
  records: SafetyRecord[]
  selected: SelectedRecord | null
  onSelect: (record: SafetyRecord) => void
  onScan: () => void
  onManual: () => void
}) {
  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
      <div className="border-b border-border bg-muted/20 px-5 py-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              High-level safety profile snapshots and ratings.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onScan}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <ScanDocumentIcon size={14} />
              <span className="ml-1.5">Scan Document</span>
            </button>
            <button
              type="button"
              onClick={onManual}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
            >
              <Plus className="mr-1.5 size-3.5" />
              Add Snapshot
            </button>
          </div>
        </div>
      </div>

      <div>
        {records.length === 0 ? (
          <div className="p-10 text-center">
            <ShieldCheck className="mx-auto size-9 text-muted-foreground/30" />
            <p className="mt-3 text-sm font-medium text-foreground">No safety snapshot found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {records.map((record) => (
              <div key={record.id}>
                <SafetyRow
                  record={record}
                  selected={
                    selected?.kind === "safety" && selected.record.id === record.id
                  }
                  onClick={() => onSelect(record)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

