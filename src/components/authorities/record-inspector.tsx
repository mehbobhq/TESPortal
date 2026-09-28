import React, { useState } from "react"
import { Archive, ArchiveRestore, FileText, History, Landmark, Pencil, X } from "lucide-react"
import { getDeadlineStatus } from "@/lib/deadline-engine"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import type { AuthorityEvidence, DeadlineRules, SelectedRecord } from "@/lib/authorities/types"
import { isDateInsideThreeYears } from "@/lib/authorities/model"
import { DeadlineBadge } from "./shared-fields"

function EvidenceHistory({
  evidence,
  onPreview,
}: {
  evidence: AuthorityEvidence[]
  onPreview: (evidence: AuthorityEvidence) => void
}) {
  const [showOlder, setShowOlder] = useState(false)

  const sorted = [...evidence].sort((a, b) =>
    (b.documentDate || b.uploadedAt).localeCompare(a.documentDate || a.uploadedAt)
  )

  const recent = sorted.filter((item) =>
    isDateInsideThreeYears(item.documentDate || item.uploadedAt)
  )

  const older = sorted.filter(
    (item) => !isDateInsideThreeYears(item.documentDate || item.uploadedAt)
  )

  const visible = showOlder ? sorted : recent

  return (
    <section className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Attached Documents & 3-Year Vault
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Original supporting certificates and filings.
          </p>
        </div>

        {older.length > 0 && (
          <button
            type="button"
            onClick={() => setShowOlder((current) => !current)}
            className="inline-flex items-center h-7 px-2 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted/50 transition-colors"
          >
            <History className="mr-1 size-3" />
            {showOlder ? "Standard View" : `Older History (${older.length})`}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No supporting documents attached.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPreview(item)}
              className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.025]"
            >
              <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{item.fileName}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {item.documentDate || item.uploadedAt.slice(0, 10)}
                  {item.ocrConfidence !== undefined &&
                    ` · OCR ${item.ocrConfidence}%`}
                </p>
              </div>
              <span className="text-[10px] font-semibold text-primary">Preview</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/* =========================================================
   INSPECTOR (VIEW = RECORD)
========================================================= */

export function RecordInspector({
  selected,
  evidence,
  rules,
  onClose,
  onEdit,
  onArchive,
  onRestore,
  onPreview,
}: {
  selected: SelectedRecord | null
  evidence: AuthorityEvidence[]
  rules: DeadlineRules
  onClose: () => void
  onEdit: () => void
  onArchive: () => void
  onRestore: () => void
  onPreview: (evidence: AuthorityEvidence) => void
}) {
  if (!selected) {
    return (
      <div className="border border-dashed border-border rounded-xl bg-card p-10 flex min-h-[520px] flex-col items-center justify-center text-center">
        <Landmark className="size-10 text-muted-foreground/30" />
        <p className="mt-4 text-sm font-medium text-foreground">Select a record</p>
        <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted-foreground">
          Click any row to inspect regulatory identifiers, dates, and attached compliance documents.
        </p>
      </div>
    )
  }

  const record = selected.record
  const attached = evidence.filter((item) => record.evidenceIds.includes(item.id))

  const title =
    selected.kind === "authority"
      ? selected.record.name
      : selected.kind === "safety"
      ? selected.record.system === "CARRIER_PROFILE_CVOR"
        ? "Carrier Profile / CVOR"
        : "SMS Profile"
      : selected.record.auditType

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
      <div className="border-b border-border bg-primary/[0.03] px-5 py-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground truncate">{title}</h3>
            {record.isArchived && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                Archived
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {record.id}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="size-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-4 p-5">
        {selected.kind === "authority" && (
          <>
            <ReadOnlyField
              label="Registration Number"
              value={selected.record.number}
              copyable
              mono
            />

            <ReadOnlyField
              label="Issuing Authority"
              value={selected.record.issuingAuthority}
            />

            <ReadOnlyField
              label="Jurisdiction"
              value={selected.record.jurisdictionLabel}
            />

            <ReadOnlyField
              label="Country"
              value={selected.record.country}
            />

            <ReadOnlyField
              label="Status"
              value={selected.record.status}
              badge={
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold border border-border bg-muted/40 text-foreground">
                  {selected.record.status}
                </span>
              }
            />

            {selected.record.authorityType === "MCS150" ? (
              <>
                <ReadOnlyField
                  label="Filed / Update Date"
                  value={selected.record.eventDate}
                />

                <ReadOnlyField
                  label="Next Action Deadline"
                  value={selected.record.nextActionDate}
                  badge={
                    <DeadlineBadge
                      status={getDeadlineStatus(
                        selected.record.nextActionDate,
                        rules
                      )}
                    />
                  }
                />
              </>
            ) : (
              <>
                <ReadOnlyField
                  label="Issue Date"
                  value={selected.record.issueDate}
                />

                <ReadOnlyField
                  label="Effective Date"
                  value={selected.record.effectiveDate}
                />

                <ReadOnlyField
                  label="Expiry Date"
                  value={selected.record.expiryDate || "Continuous"}
                  badge={
                    <DeadlineBadge
                      status={getDeadlineStatus(
                        selected.record.expiryDate,
                        rules
                      )}
                    />
                  }
                />
              </>
            )}

            {selected.record.notes && (
              <ReadOnlyField label="Notes" value={selected.record.notes} />
            )}
          </>
        )}

        {selected.kind === "safety" && (
          <>
            <ReadOnlyField
              label="Jurisdiction"
              value={selected.record.jurisdictionLabel}
            />

            <ReadOnlyField
              label="Country"
              value={selected.record.country}
            />

            <ReadOnlyField
              label="Review Date"
              value={selected.record.reviewDate}
            />

            <ReadOnlyField
              label="Summary"
              value={selected.record.summary}
            />

            {selected.record.notes && (
              <ReadOnlyField label="Notes" value={selected.record.notes} />
            )}
          </>
        )}

        {selected.kind === "audit" && (
          <>
            <ReadOnlyField
              label="Regulator"
              value={selected.record.regulator}
            />

            <ReadOnlyField
              label="Jurisdiction"
              value={selected.record.jurisdictionLabel}
            />

            <ReadOnlyField
              label="Reference"
              value={selected.record.referenceNumber}
              copyable
              mono
            />

            <ReadOnlyField
              label="Notice Date"
              value={selected.record.noticeDate}
            />

            <ReadOnlyField
              label="Due Date"
              value={selected.record.dueDate}
            />

            <ReadOnlyField
              label="Completed Date"
              value={selected.record.completedDate}
            />

            <ReadOnlyField
              label="Status"
              value={selected.record.status}
              badge={
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold border border-border bg-muted/40 text-foreground">
                  {selected.record.status}
                </span>
              }
            />

            <ReadOnlyField
              label="Outcome"
              value={selected.record.outcome}
            />

            <ReadOnlyField
              label="Score / Rating"
              value={selected.record.score}
            />

            {selected.record.notes && (
              <ReadOnlyField label="Notes" value={selected.record.notes} />
            )}
          </>
        )}

        <EvidenceHistory evidence={attached} onPreview={onPreview} />

        <div className="flex gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 inline-flex items-center justify-center px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
          >
            <Pencil className="mr-1.5 size-3.5" />
            Edit
          </button>

          {record.isArchived ? (
            <button
              type="button"
              onClick={onRestore}
              className="flex-1 inline-flex items-center justify-center px-3 py-2 text-xs font-semibold rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              <ArchiveRestore className="mr-1.5 size-3.5" />
              Restore
            </button>
          ) : (
            <button
              type="button"
              onClick={onArchive}
              className="flex-1 inline-flex items-center justify-center px-3 py-2 text-xs font-semibold rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
            >
              <Archive className="mr-1.5 size-3.5" />
              Archive
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

