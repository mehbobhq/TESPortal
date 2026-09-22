import {
  CalendarDays,
  Check,
  FileText,
  Landmark,
  Pencil,
  Plus,
  Upload,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { FrequencyAssignmentForm } from "@/src/components/tax-filing/FrequencyAssignmentForm"
import { TaxProfileForm } from "@/src/components/tax-filing/TaxProfileForm"
import { formatFrequency } from "@/src/components/tax-filing/tax-helpers"
import { TESEvidenceLayout } from "@/src/components/design-system/TESEvidenceLayout"
import type {
  FrequencyAssignment,
  TaxDefinition,
  TaxDocument,
  TaxProfile,
} from "@/src/components/tax-filing/types"

type TaxProfileWorkspaceProps = {
  profile: TaxProfile | null
  definition: TaxDefinition | null
  isEditing: boolean
  showFrequencyForm: boolean
  calendarYear: number
  isPersistedProfile: boolean
  documents?: TaxDocument[]
  onClose: () => void
  onProfileChange: (profile: TaxProfile) => void
  onEdit: () => void
  onCancelEdit: () => void
  onSaveProfile: () => void
  onBeginFrequencyChange: () => void
  onCancelFrequencyChange: () => void
  onSaveFrequencyAssignment: (assignment: FrequencyAssignment) => void
  onUploadEvidence: () => void
  onGenerateYear: () => void
  onCreateManualPeriod: () => void
  onPreviewDocument: (document: TaxDocument) => void
}

function TaxProfileWorkspace({
  profile,
  definition,
  isEditing,
  showFrequencyForm,
  calendarYear,
  isPersistedProfile,
  documents = [],
  onClose,
  onProfileChange,
  onEdit,
  onCancelEdit,
  onSaveProfile,
  onBeginFrequencyChange,
  onCancelFrequencyChange,
  onSaveFrequencyAssignment,
  onUploadEvidence,
  onGenerateYear,
  onCreateManualPeriod,
  onPreviewDocument,
}: TaxProfileWorkspaceProps) {
  return (
    <div className="xl:sticky xl:top-6">
      {!profile || !definition ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center min-h-[500px] flex flex-col items-center justify-center">
          <Landmark className="size-10 text-muted-foreground/30" />
          <p className="mt-4 text-sm font-semibold text-foreground">Select a tax program</p>
          <p className="mt-1 max-w-[280px] text-xs leading-relaxed text-muted-foreground">
            Review registered account numbers, effective-dated frequency history, and attached compliance evidence.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
          <div className="border-b border-border/60 bg-muted/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  {definition.shortName}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {definition.description}
                </p>
              </div>

              <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div className="p-5">
          <TESEvidenceLayout
            evidenceLabel="Tax Evidence"
            record={
          <div className="space-y-6">
            {isEditing ? (
              <TaxProfileForm
                profile={profile}
                definition={definition}
                onChange={onProfileChange}
              />
            ) : (
              /* VIEW MODE: CLEAN DOCUMENT-STYLE LABEL/VALUE TILES */
              <div className="space-y-5">
                <div className="grid gap-3.5 md:grid-cols-2">
                  <ReadOnlyField
                    label="Tax Program"
                    value={definition.name}
                  />
                  <ReadOnlyField
                    label="Jurisdiction"
                    value={definition.jurisdiction}
                  />
                  <ReadOnlyField
                    label={definition.accountLabel}
                    value={profile.accountNumber || "Not configured"}
                    mono
                    copyable
                  />
                  <ReadOnlyField
                    label="Account Status"
                    value={profile.accountStatus}
                  />
                  <ReadOnlyField
                    label="Filing Frequency"
                    value={formatFrequency(profile.filingFrequency)}
                    subtext="Current active frequency"
                  />
                  <ReadOnlyField
                    label="Effective Date"
                    value={profile.effectiveDate}
                  />
                  <ReadOnlyField
                    label="Closure Date"
                    value={profile.closureDate}
                  />
                </div>

                <div className="border-t border-border/60 pt-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Verification Details
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <ReadOnlyField
                      label="Verification Source"
                      value={profile.verificationSource}
                    />
                    <ReadOnlyField
                      label="Verification Reference"
                      value={profile.verificationReference}
                      mono
                    />
                    <ReadOnlyField
                      label="Last Verified Date"
                      value={profile.lastVerifiedDate}
                    />
                    <ReadOnlyField
                      label="Last Verified By"
                      value={profile.lastVerifiedBy}
                    />
                  </div>
                  {profile.notes && (
                    <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-2.5 text-xs text-muted-foreground">
                      {profile.notes}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* FREQUENCY HISTORY (LOCKED IMMUTABILITY) */}
            <div className="border-t border-border/60 pt-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Filing Frequency History
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Effective-dated frequency assignments. Existing obligations remain immutable.
                  </p>
                </div>

                <Button type="button" variant="outline" size="sm" onClick={onBeginFrequencyChange}>
                  <Plus className="size-3.5" /> Add Change
                </Button>
              </div>

              {showFrequencyForm && (
                <div className="mt-4">
                  <FrequencyAssignmentForm
                    definition={definition}
                    onSave={onSaveFrequencyAssignment}
                    onCancel={onCancelFrequencyChange}
                  />
                </div>
              )}

              <div className="mt-3 space-y-2">
                {profile.frequencyHistory.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    No frequency changes recorded yet.
                  </div>
                ) : (
                  [...profile.frequencyHistory]
                    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
                    .map((assignment) => (
                      <div key={assignment.id} className="rounded-xl border border-border bg-card p-3 shadow-2xs">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-foreground">
                              {formatFrequency(assignment.frequency)}
                            </p>
                            <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                              {assignment.effectiveFrom}
                              {assignment.effectiveTo
                                ? ` → ${assignment.effectiveTo}`
                                : " → Current"}
                            </p>
                          </div>
                          <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground">
                            {assignment.assignmentType}
                          </span>
                        </div>

                        {(assignment.source || assignment.sourceReference) && (
                          <p className="mt-2 text-[10px] text-muted-foreground">
                            {assignment.source}
                            {assignment.sourceReference ? ` · ${assignment.sourceReference}` : ""}
                          </p>
                        )}
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* ACTION CONTROLS */}
            <div className="border-t border-border/60 pt-5">
              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <Button type="button" onClick={onSaveProfile} className="flex-1">
                      <Check className="size-4" /> Save Record
                    </Button>
                    {isPersistedProfile && (
                      <Button type="button" variant="outline" onClick={onCancelEdit}>
                        Cancel
                      </Button>
                    )}
                  </>
                ) : (
                  <Button type="button" onClick={onEdit} className="flex-1">
                    <Pencil className="size-4" /> Edit Profile
                  </Button>
                )}

                <Button type="button" variant="outline" onClick={onUploadEvidence}>
                  <Upload className="size-4" /> Upload Evidence
                </Button>
              </div>

              {isPersistedProfile && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" size="sm" onClick={onGenerateYear}>
                    <CalendarDays className="size-3.5" /> Generate {calendarYear}
                  </Button>

                  <Button type="button" variant="outline" size="sm" onClick={onCreateManualPeriod}>
                    <Plus className="size-3.5" /> Manual Period
                  </Button>
                </div>
              )}
            </div>
          </div>
            }
            evidence={
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Attached Tax Evidence
                </p>
                <div className="mt-3 space-y-2">
                  {documents.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                      No registration evidence attached.
                    </div>
                  ) : (
                    documents.map((document) => (
                      <button
                        key={document.id}
                        type="button"
                        onClick={() => onPreviewDocument(document)}
                        className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted/30"
                      >
                        <FileText className="mt-0.5 size-4 text-primary shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-foreground">{document.fileName}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {document.documentType} · {document.documentDate || document.uploadedAt.slice(0, 10)}
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            }
          />
          </div>
        </div>
      )}
    </div>
  )
}

export { TaxProfileWorkspace }
export type { TaxProfileWorkspaceProps }
