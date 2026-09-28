import React from "react"
import { Plus, Save, X } from "lucide-react"
import type { AuthorityDraft, SafetyDraft, AuditDraft, AuthorityRecord, AuditRecord, AuthorityType } from "@/lib/authorities/types"
import type { AuthorityProfile } from "@/lib/authorities/model"
import { authorityOptions, authorityDisplayName, defaultIssuingAuthority } from "@/lib/authorities/model"
import { JurisdictionCountryFields } from "./shared-fields"

export function AuthorityForm({
  draft,
  profile,
  onChange,
}: {
  draft: AuthorityDraft
  profile: AuthorityProfile
  onChange: (draft: AuthorityDraft) => void
}) {
  const options = authorityOptions(draft.category, profile)
  const periodic = draft.authorityType === "MCS150"
  const allowedCountries: ("Canada" | "United States")[] =
    draft.category === "canadian" ? ["Canada"] : ["United States"]

  const patch = (value: Partial<AuthorityDraft>) => {
    onChange({ ...draft, ...value })
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/20 px-5 py-3.5">
        <h4 className="text-sm font-semibold text-foreground">Authority / Registration Information</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          OCR and manual entry use the same authoritative fields.
        </p>
      </div>

      <div className="p-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Record Type *</label>
          <select
            value={draft.authorityType}
            onChange={(e) => {
              const type = e.target.value as AuthorityType
              patch({
                authorityType: type,
                name: authorityDisplayName(type),
                issuingAuthority: defaultIssuingAuthority(type),
              })
            }}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Display Name *</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            {periodic
              ? "Reference / Filing Number"
              : "Authority / Registration Number *"}
          </label>
          <input
            type="text"
            value={draft.number}
            onChange={(e) => patch({ number: e.target.value })}
            placeholder={
              draft.authorityType === "USDOT"
                ? "e.g. 3928102"
                : draft.authorityType === "MC"
                ? "e.g. MC-849201"
                : "Enter identifier"
            }
            className="w-full px-3 py-2 text-xs font-mono border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Issuing Authority</label>
          <input
            type="text"
            value={draft.issuingAuthority}
            onChange={(e) => patch({ issuingAuthority: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <JurisdictionCountryFields
          jurisdictionCode={draft.jurisdictionCode}
          country={draft.country}
          allowedCountries={allowedCountries}
          onChange={(value) => patch(value)}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Record Status</label>
          <select
            value={draft.status}
            onChange={(e) =>
              patch({ status: e.target.value as AuthorityRecord["status"] })
            }
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="Active">Active</option>
            <option value="Pending">Pending</option>
            <option value="Inactive">Inactive</option>
            <option value="Suspended">Suspended</option>
            <option value="Expired">Expired</option>
          </select>
        </div>

        {periodic ? (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Filed / Update Date</label>
              <input
                type="date"
                value={draft.eventDate}
                onChange={(e) => patch({ eventDate: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Next Action Date</label>
              <input
                type="date"
                value={draft.nextActionDate}
                onChange={(e) => patch({ nextActionDate: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-[10px] text-muted-foreground">
                Next scheduled biennial filing deadline calculated from USDOT number.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Issue Date</label>
              <input
                type="date"
                value={draft.issueDate}
                onChange={(e) => patch({ issueDate: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Effective Date</label>
              <input
                type="date"
                value={draft.effectiveDate}
                onChange={(e) => patch({ effectiveDate: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Expiry Date</label>
              <input
                type="date"
                value={draft.expiryDate}
                onChange={(e) => patch({ expiryDate: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </>
        )}

        <div className="space-y-1.5 md:col-span-2">
          <label className="text-xs font-semibold text-foreground">Notes</label>
          <input
            type="text"
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Optional compliance notes or reference details"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   SAFETY FORM
========================================================= */

export function SafetyForm({
  draft,
  onChange,
}: {
  draft: SafetyDraft
  onChange: (draft: SafetyDraft) => void
}) {
  const patch = (value: Partial<SafetyDraft>) => {
    onChange({ ...draft, ...value })
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/20 px-5 py-3.5">
        <h4 className="text-sm font-semibold text-foreground">
          {draft.system === "CARRIER_PROFILE_CVOR"
            ? "Carrier Profile / CVOR Snapshot"
            : "SMS Safety Profile Snapshot"}
        </h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          High-level safety ratings and review records.
        </p>
      </div>

      <div className="p-5 grid gap-4 md:grid-cols-2">
        <JurisdictionCountryFields
          jurisdictionCode={draft.jurisdictionCode}
          country={draft.country}
          allowedCountries={
            draft.system === "CARRIER_PROFILE_CVOR"
              ? ["Canada"]
              : ["United States"]
          }
          onChange={(value) => patch(value)}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Review Date</label>
          <input
            type="date"
            value={draft.reviewDate}
            onChange={(e) => patch({ reviewDate: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Status Summary</label>
          <input
            type="text"
            value={draft.summary}
            onChange={(e) => patch({ summary: e.target.value })}
            placeholder="e.g. Satisfactory / 0% Safety Rating / No Violations"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <label className="text-xs font-semibold text-foreground">Notes</label>
          <input
            type="text"
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   AUDIT FORM
========================================================= */

export function AuditForm({
  draft,
  onChange,
}: {
  draft: AuditDraft
  onChange: (draft: AuditDraft) => void
}) {
  const patch = (value: Partial<AuditDraft>) => {
    onChange({ ...draft, ...value })
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/20 px-5 py-3.5">
        <h4 className="text-sm font-semibold text-foreground">Audit / Intervention Details</h4>
      </div>

      <div className="p-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Audit / Intervention Type *</label>
          <input
            type="text"
            value={draft.auditType}
            onChange={(e) => patch({ auditType: e.target.value })}
            placeholder="e.g. FMCSA Comprehensive Review, CVOR Audit"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Regulator / Authority *</label>
          <input
            type="text"
            value={draft.regulator}
            onChange={(e) => patch({ regulator: e.target.value })}
            placeholder="e.g. FMCSA, MTO, Alberta Transportation"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <JurisdictionCountryFields
          jurisdictionCode={draft.jurisdictionCode}
          country={draft.country}
          onChange={(value) => patch(value)}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Notice / Reference Number</label>
          <input
            type="text"
            value={draft.referenceNumber}
            onChange={(e) => patch({ referenceNumber: e.target.value })}
            className="w-full px-3 py-2 text-xs font-mono border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Notice Date</label>
          <input
            type="date"
            value={draft.noticeDate}
            onChange={(e) => patch({ noticeDate: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Due Date</label>
          <input
            type="date"
            value={draft.dueDate}
            onChange={(e) => patch({ dueDate: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Completed Date</label>
          <input
            type="date"
            value={draft.completedDate}
            onChange={(e) => patch({ completedDate: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Status</label>
          <select
            value={draft.status}
            onChange={(e) =>
              patch({ status: e.target.value as AuditRecord["status"] })
            }
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="Open">Open</option>
            <option value="Scheduled">Scheduled</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
            <option value="Closed">Closed</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Outcome</label>
          <input
            type="text"
            value={draft.outcome}
            onChange={(e) => patch({ outcome: e.target.value })}
            placeholder="e.g. Satisfactory, Conditional, Closed with No Action"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Score / Rating</label>
          <input
            type="text"
            value={draft.score}
            onChange={(e) => patch({ score: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Follow-up Required</label>
          <select
            value={draft.followUpRequired ? "yes" : "no"}
            onChange={(e) =>
              patch({ followUpRequired: e.target.value === "yes" })
            }
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>

        {draft.followUpRequired && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Follow-up Due Date</label>
            <input
              type="date"
              value={draft.followUpDueDate}
              onChange={(e) => patch({ followUpDueDate: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        <div className="space-y-1.5 md:col-span-2">
          <label className="text-xs font-semibold text-foreground">Notes</label>
          <input
            type="text"
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   MANUAL MODAL
========================================================= */

export type ManualState =
  | {
      mode: "authority"
      draft: AuthorityDraft
    }
  | {
      mode: "safety"
      draft: SafetyDraft
    }
  | {
      mode: "audit"
      draft: AuditDraft
    }

export function ManualModal({
  state,
  profile,
  onChange,
  onCancel,
  onSave,
}: {
  state: ManualState
  profile: AuthorityProfile
  onChange: (state: ManualState) => void
  onCancel: () => void
  onSave: () => void
}) {
  const ready =
    state.mode === "authority"
      ? Boolean(
          state.draft.name.trim() &&
            (state.draft.authorityType === "MCS150" ||
              state.draft.number.trim())
        )
      : state.mode === "safety"
      ? Boolean(state.draft.reviewDate)
      : Boolean(state.draft.auditType.trim() && state.draft.regulator.trim())

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-black/45 p-4 backdrop-blur-sm flex items-center justify-center">
      <div className="w-full max-w-5xl my-6 bg-card border border-border rounded-2xl shadow-xl overflow-hidden">
        <div className="border-b border-border px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {state.mode === "authority"
                ? "Add Authority / Registration"
                : state.mode === "safety"
                ? "Add Safety Snapshot"
                : "Add Audit / Intervention"}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manual entry uses the same authoritative record model as OCR.
            </p>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {state.mode === "authority" && (
            <AuthorityForm
              draft={state.draft}
              profile={profile}
              onChange={(draft) =>
                onChange({
                  mode: "authority",
                  draft,
                })
              }
            />
          )}

          {state.mode === "safety" && (
            <SafetyForm
              draft={state.draft}
              onChange={(draft) =>
                onChange({
                  mode: "safety",
                  draft,
                })
              }
            />
          )}

          {state.mode === "audit" && (
            <AuditForm
              draft={state.draft}
              onChange={(draft) =>
                onChange({
                  mode: "audit",
                  draft,
                })
              }
            />
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!ready}
              onClick={onSave}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
            >
              <Save className="size-4" />
              Save Record
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
