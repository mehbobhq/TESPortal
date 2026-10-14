import React from "react"
import { CheckCircle2, Loader2, Save, Sparkles, X } from "lucide-react"
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable"
import type { AuthorityDraft, OCRSession } from "./types"
import type { AuthorityProfile } from "./model"
import { ScanDocumentIcon } from "./shared-fields"
import { AuthorityForm, SafetyForm, AuditForm } from "./forms"

/**
 * The legacy document-intelligence endpoints are quarantined and OCR extraction has no approved canonical pipeline yet:
 * "Extract Data" refuses, the scanned file is shown for reference only, and the fields are entered by hand.
 */
const OCR_UNAVAILABLE_REASON =
  "automatic extraction has no approved canonical pipeline yet (the legacy OCR endpoints are quarantined). Review the document and enter the fields by hand."

function SourcePreview({ session }: { session: OCRSession }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col bg-muted/20">
      <div className="border-b border-border bg-card px-4 py-2 text-xs font-semibold text-foreground">Authority Source Document</div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {session.file.type === "application/pdf" ? (
          <iframe title={session.file.name} src={session.dataUrl} className="h-full min-h-[480px] w-full rounded border border-border bg-background" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.dataUrl} alt={session.file.name} className="mx-auto max-h-full max-w-full rounded border border-border" />
        )}
      </div>
    </div>
  )
}

export function OCRWorkspace({
  session,
  profile,
  companyName,
  setSession,
  onCancel,
  onReplace,
  onSave,
  onCheckNumber,
  error,
  saving = false,
}: {
  session: OCRSession
  profile: AuthorityProfile
  companyName: string
  setSession: React.Dispatch<React.SetStateAction<OCRSession | null>>
  onCancel: () => void
  onReplace: () => void
  onSave: () => void
  onCheckNumber?: (draft: AuthorityDraft) => Promise<string>
  error?: string | null
  saving?: boolean
}) {
  // Extraction is refused honestly; the review form below stays usable for manual entry.
  const run = () => {
    setSession((current) => (current ? { ...current, extractionComplete: true } : current))
  }

  const ready =
    session.mode === "authority"
      ? Boolean(
          session.authorityDraft?.name.trim() &&
            (session.authorityDraft?.authorityType === "MCS150" ||
              session.authorityDraft?.number.trim())
        )
      : session.mode === "safety"
      ? Boolean(session.safetyDraft?.reviewDate)
      : Boolean(
          session.auditDraft?.auditType.trim() &&
            session.auditDraft?.regulator.trim()
        )

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-background">
      <div className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-5 bg-card">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ScanDocumentIcon size={18} />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">Document Intelligence Review</p>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold border border-primary/20 bg-primary/5 text-primary">
                <Sparkles className="size-3" />
                AI Assisted
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">{session.file.name}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(520px,1fr)_minmax(620px,1fr)]">
        <div className="min-h-0 border-r border-border">
          <SourcePreview session={session} />
          <div className="border-t border-border p-3">
            <button type="button" onClick={onReplace} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors">
              Replace Document
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-col bg-card">
          <div className="border-b border-border p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Extracted Information</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  OCR is the primary intake layer. Review or correct extracted fields before saving.
                </p>
              </div>

              {session.confidence !== undefined && (
                <div className="text-right">
                  <p className="text-xl font-bold text-emerald-600">
                    {session.confidence}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">OCR confidence</p>
                </div>
              )}
            </div>

            {!session.extractionComplete && (
              <button
                type="button"
                disabled={session.processing}
                onClick={run}
                className="mt-4 inline-flex items-center px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
              >
                {session.processing ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <ScanDocumentIcon size={15} />
                    <span className="ml-2">Extract Data</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <div className="mb-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Document Date</label>
                <input
                  type="date"
                  value={session.documentDate}
                  onChange={(e) =>
                    setSession((current) =>
                      current
                        ? { ...current, documentDate: e.target.value }
                        : current
                    )
                  }
                  className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-[10px] text-muted-foreground">
                  Used for 3-year compliance history organization.
                </p>
              </div>
            </div>

            {session.mode === "authority" && session.authorityDraft && (
              <AuthorityForm
                draft={session.authorityDraft}
                profile={profile}
                onCheckNumber={onCheckNumber}
                onChange={(authorityDraft) =>
                  setSession((current) =>
                    current ? { ...current, authorityDraft } : current
                  )
                }
              />
            )}

            {session.mode === "safety" && session.safetyDraft && (
              <SafetyForm
                draft={session.safetyDraft}
                onChange={(safetyDraft) =>
                  setSession((current) =>
                    current ? { ...current, safetyDraft } : current
                  )
                }
              />
            )}

            {session.mode === "audit" && session.auditDraft && (
              <AuditForm
                draft={session.auditDraft}
                onChange={(auditDraft) =>
                  setSession((current) =>
                    current ? { ...current, auditDraft } : current
                  )
                }
              />
            )}
          </div>

          <div className="space-y-2 border-t border-border bg-muted/10 p-4">
            <CanonicalUnavailable action="Extract Data and document storage" reason={OCR_UNAVAILABLE_REASON + " The scanned document itself is NOT stored: saving keeps only the fields you enter."} />
            {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">{error}</p> : null}
          </div>
          <div className="flex justify-end border-t border-border p-4 bg-muted/10">
            <button
              type="button"
              disabled={!ready || saving}
              onClick={onSave}
              className="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
            >
              <CheckCircle2 className="mr-2 size-4" />
              {saving ? "Saving..." : "Save Record"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
