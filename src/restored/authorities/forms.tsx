import React, { useState } from "react"
import { Save, X } from "lucide-react"
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable"
import type { AuthorityDraft, SafetyDraft, AuditDraft, AuthorityRecord, AuditRecord, AuthorityType, CanonicalAuthorityKind } from "./types"
import type { AuthorityProfile } from "./model"
import {
  authorityOptions,
  authorityDisplayName,
  defaultIssuingAuthority,
  defaultKindFor,
  KIND_CHOICES,
  KIND_LABEL,
  kindDisplayName,
  kindFixedRegion,
  kindHasExpiry,
  kindIsNational,
} from "./model"
import { JurisdictionCountryFields } from "./shared-fields"

export type EditMode = "change" | "correct"

export function AuthorityForm({
  draft,
  profile,
  onChange,
  isEditing = false,
  editMode = "change",
  onEditModeChange,
  onCheckNumber,
}: {
  draft: AuthorityDraft
  profile: AuthorityProfile
  onChange: (draft: AuthorityDraft) => void
  /** Editing an existing canonical record: its type is fixed and a change must say whether it is real or a correction. */
  isEditing?: boolean
  editMode?: EditMode
  onEditModeChange?: (mode: EditMode) => void
  onCheckNumber?: (draft: AuthorityDraft) => Promise<string>
}) {
  const options = authorityOptions(draft.category, profile)
  const periodic = draft.authorityType === "MCS150"
  const kind = draft.canonicalKind
  const kindChoices = KIND_CHOICES[draft.authorityType] ?? []
  const national = kind ? kindIsNational(kind) : false
  const fixedRegion = kind ? kindFixedRegion(kind) : null
  const allowedCountries: ("Canada" | "United States")[] | undefined =
    draft.authorityType === "IRP" ? undefined : draft.category === "canadian" ? ["Canada"] : ["United States"]
  const [checkMessage, setCheckMessage] = useState<string | null>(null)

  const patch = (value: Partial<AuthorityDraft>) => {
    setCheckMessage(null)
    onChange({ ...draft, ...value })
  }

  const withKind = (next: CanonicalAuthorityKind | "", type: AuthorityType): Partial<AuthorityDraft> => {
    const fixed = next ? kindFixedRegion(next) : null
    const base: Partial<AuthorityDraft> = {
      authorityType: type,
      canonicalKind: next,
      name: next ? kindDisplayName(next) : authorityDisplayName(type),
      issuingAuthority: defaultIssuingAuthority(type),
    }
    if (fixed) return { ...base, jurisdictionCode: fixed, jurisdictionLabel: "Ontario", country: "Canada" }
    return base
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
            disabled={isEditing}
            onChange={(e) => {
              const type = e.target.value as AuthorityType
              patch(withKind(defaultKindFor(type), type))
            }}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-70"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {kindChoices.length > 1 ? (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Registry Kind *</label>
            <select
              value={kind}
              disabled={isEditing}
              onChange={(e) => patch(withKind(e.target.value as CanonicalAuthorityKind, draft.authorityType))}
              className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-70"
            >
              {kindChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {KIND_LABEL[choice]}
                </option>
              ))}
            </select>
          </div>
        ) : null}

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
          {onCheckNumber && kind ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCheckMessage("Checking...")
                  onCheckNumber(draft).then(setCheckMessage, (error: unknown) => setCheckMessage(error instanceof Error ? error.message : "The number could not be checked."))
                }}
                className="text-[10px] font-semibold text-primary hover:underline"
              >
                Check number in the TES registry
              </button>
              {checkMessage ? <span role="status" className="text-[10px] text-muted-foreground">{checkMessage}</span> : null}
            </div>
          ) : null}
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
          fixedLabel={national ? (draft.country === "Canada" ? "Federal — Canada" : "Federal — United States") : fixedRegion ? "Ontario (ON)" : undefined}
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
            <option value="Revoked">Revoked</option>
            <option value="Canceled">Canceled</option>
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
                disabled={Boolean(kind) && !kindHasExpiry(kind as CanonicalAuthorityKind)}
                onChange={(e) => patch({ expiryDate: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              />
              {kind && !kindHasExpiry(kind) ? <p className="text-[10px] text-muted-foreground">{kind} records do not expire.</p> : null}
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

        {!kind ? (
          <div className="md:col-span-2">
            <CanonicalUnavailable
              action={`Saving a ${authorityDisplayName(draft.authorityType)} record`}
              reason="TES stores operating authorities as USDOT, MC, MVID, RIN, CVOR, NSC / Safety Fitness and IRP records only; this record type has no canonical kind yet, so it cannot be saved."
            />
          </div>
        ) : null}
        <div className="md:col-span-2">
          <CanonicalUnavailable
            action="Display Name, Issuing Authority, Filed / Update Date, Next Action Date and Notes"
            reason="these fields have no canonical home yet. They are shown as originally designed, but a record that fills them in is refused rather than losing them."
          />
        </div>

        {isEditing ? (
          <fieldset className="md:col-span-2 space-y-1.5 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold text-foreground">What kind of edit is this?</legend>
            <label className="flex items-start gap-2 text-xs text-foreground">
              <input type="radio" name="authority-edit-mode" checked={editMode === "change"} onChange={() => onEditModeChange?.("change")} className="mt-0.5" />
              <span>A real-world change (the earlier version stays as history; the Effective Date above is when it took effect).</span>
            </label>
            <label className="flex items-start gap-2 text-xs text-foreground">
              <input type="radio" name="authority-edit-mode" checked={editMode === "correct"} onChange={() => onEditModeChange?.("correct")} className="mt-0.5" />
              <span>The recorded value was wrong (correct it; the wrong value is kept and flagged as a correction, never as history).</span>
            </label>
            {kind && kindIsNational(kind) ? <p className="text-[10px] text-muted-foreground">A {kind} number does not change in place: only a correction can change it.</p> : null}
            {kind === "IRP" ? <p className="text-[10px] text-muted-foreground">An IRP base-jurisdiction move is a real change; a wrongly recorded base is a correction.</p> : null}
          </fieldset>
        ) : null}
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
  isEditing = false,
  editMode = "change",
  onEditModeChange,
  onCheckNumber,
  error,
  saving = false,
}: {
  state: ManualState
  profile: AuthorityProfile
  onChange: (state: ManualState) => void
  onCancel: () => void
  onSave: () => void
  isEditing?: boolean
  editMode?: EditMode
  onEditModeChange?: (mode: EditMode) => void
  onCheckNumber?: (draft: AuthorityDraft) => Promise<string>
  /** The refusal or failure of the last save attempt (including "not available yet"), shown in the modal. */
  error?: string | null
  saving?: boolean
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
                ? isEditing
                  ? "Edit Authority / Registration"
                  : "Add Authority / Registration"
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
            aria-label="Close"
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
              isEditing={isEditing}
              editMode={editMode}
              onEditModeChange={onEditModeChange}
              onCheckNumber={onCheckNumber}
              onChange={(draft) =>
                onChange({
                  mode: "authority",
                  draft,
                })
              }
            />
          )}

          {state.mode === "safety" && (
            <>
              <SafetyForm
                draft={state.draft}
                onChange={(draft) =>
                  onChange({
                    mode: "safety",
                    draft,
                  })
                }
              />
              <CanonicalUnavailable
                action="Saving a safety snapshot"
                reason="safety profile snapshots (Carrier Profile / CVOR, SMS) have no canonical PostgreSQL storage yet, so saving is refused instead of keeping the snapshot in this browser."
              />
            </>
          )}

          {state.mode === "audit" && (
            <>
              <AuditForm
                draft={state.draft}
                onChange={(draft) =>
                  onChange({
                    mode: "audit",
                    draft,
                  })
                }
              />
              <CanonicalUnavailable
                action="Saving an audit or intervention record"
                reason="regulatory audit and intervention records have no canonical PostgreSQL storage yet, so saving is refused instead of keeping the record in this browser."
              />
            </>
          )}

          {error ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </p>
          ) : null}

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
              disabled={!ready || saving}
              onClick={onSave}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
            >
              <Save className="size-4" />
              {saving ? "Saving..." : "Save Record"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
